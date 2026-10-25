import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { OrganizationSlugService } from '../src/modules/auth/organization-slug.service';
import type {
  PublicUser,
  TenantContext,
} from '../src/modules/auth/types/request-context';

interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  role: string;
}
interface Session {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  user: PublicUser;
  memberships: Membership[];
}
const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'authentication and live tenant authorization over HTTP with PostgreSQL',
  {
    skip:
      !databaseUrl &&
      'Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL test database',
  },
  async (t) => {
    const db = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication({ logger: false });
    const fixtureId = randomUUID();
    const fixtureEmails = new Set<string>();
    const organizationNames = new Set<string>();
    const password = 'a long test password without arbitrary complexity';
    let sequence = 0;
    const input = (label: string) => {
      const email = `${fixtureId}-${sequence++}@example.invalid`;
      const organizationName = `auth-${fixtureId}-${label}-${sequence}`;
      fixtureEmails.add(email);
      organizationNames.add(organizationName);
      return { email, organizationName, name: 'Auth Fixture', password };
    };
    function safe(body: unknown) {
      const encoded = JSON.stringify(body);
      assert.ok(
        !/passwordHash|tokenHash|JWT_ACCESS_SECRET|stack|PrismaClient/.test(
          encoded,
        ),
      );
      assert.ok(!encoded.includes(password));
      assert.ok(
        !encoded.includes(process.env.JWT_ACCESS_SECRET ?? 'missing-secret'),
      );
    }
    async function request<T = Record<string, unknown>>(
      path: string,
      body?: unknown,
      access?: string,
      organizationId?: string,
    ) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (access) headers.authorization = `Bearer ${access}`;
      if (organizationId !== undefined)
        headers['x-organization-id'] = organizationId;
      const response = await fetch(`${await app.getUrl()}/auth/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (response.status === 401)
        assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      const parsed: unknown =
        response.status === 204 ? null : await response.json();
      safe(parsed);
      return {
        status: response.status,
        body: parsed as T,
        headers: response.headers,
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      const credentials = input('owner');
      const registered = await request<Session>('register', {
        ...credentials,
        email: `  ${credentials.email.toUpperCase()}  `,
      });
      assert.equal(registered.status, 201);
      let session = registered.body;
      const organizationId = session.memberships[0]!.organizationId;
      const membershipId = session.memberships[0]!.membershipId;
      const jwt = app.get(JwtService);

      await t.test(
        'register creates safe user, organization, owner membership, and hashed session atomically',
        async () => {
          assert.equal(session.user.email, credentials.email);
          assert.equal(session.memberships[0]!.role, 'OWNER');
          assert.equal(
            session.memberships[0]!.organizationName,
            credentials.organizationName,
          );
          assert.deepEqual(Object.keys(session.user).sort(), [
            'avatarUrl',
            'email',
            'id',
            'isActive',
            'name',
          ]);
          assert.equal(registered.headers.get('cache-control'), 'no-store');
          const stored = await db.user.findUniqueOrThrow({
            where: { id: session.user.id },
          });
          assert.match(stored.passwordHash, /^\$argon2id\$/);
          const token = await db.refreshToken.findUniqueOrThrow({
            where: {
              tokenHash: createHash('sha256')
                .update(session.refreshToken)
                .digest('hex'),
            },
          });
          assert.ok(token.tokenHash !== session.refreshToken);
          const payload = jwt.decode<Record<string, unknown>>(
            session.accessToken,
          );
          assert.equal(payload.sub, session.user.id);
          assert.equal(payload.sid, token.id);
          assert.equal(Number(payload.exp) - Number(payload.iat), 900);
          assert.equal(payload.role, undefined);
          assert.equal(payload.organizationId, undefined);
        },
      );
      await t.test(
        'duplicate normalized email returns 409 without partial organization',
        async () => {
          const duplicate = input('duplicate');
          const result = await request('register', {
            ...duplicate,
            email: credentials.email.toUpperCase(),
          });
          assert.equal(result.status, 409);
          assert.equal(
            await db.organization.count({
              where: { name: duplicate.organizationName },
            }),
            0,
          );
        },
      );
      await t.test(
        'concurrent registration enforces unique normalized email',
        async () => {
          const concurrent = input('concurrent');
          const results = await Promise.all([
            request('register', concurrent),
            request('register', concurrent),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            await db.user.count({ where: { email: concurrent.email } }),
            1,
          );
        },
      );
      await t.test('slug collision is retried safely', async () => {
        const slugs = app.get(OrganizationSlugService);
        const original = slugs.create.bind(slugs);
        let attempts = 0;
        const stub = mock.method(slugs, 'create', (name: string) =>
          attempts++ === 0
            ? session.memberships[0]!.organizationSlug
            : original(name),
        );
        try {
          assert.equal((await request('register', input('slug'))).status, 201);
          assert.equal(attempts, 2);
        } finally {
          stub.mock.restore();
        }
      });
      await t.test(
        'late session signing failure rolls back user, organization, membership and refresh writes',
        async () => {
          const rollback = input('rollback');
          const before = await db.refreshToken.count({
            where: { user: { email: { in: [...fixtureEmails] } } },
          });
          const stub = mock.method(jwt, 'signAsync', async () => {
            throw new Error('sensitive internal signing failure');
          });
          try {
            const failed = await request('register', rollback);
            assert.equal(failed.status, 500);
            assert.deepEqual(failed.body, {
              statusCode: 500,
              message: 'Internal server error',
            });
          } finally {
            stub.mock.restore();
          }
          assert.equal(
            await db.user.count({ where: { email: rollback.email } }),
            0,
          );
          assert.equal(
            await db.organization.count({
              where: { name: rollback.organizationName },
            }),
            0,
          );
          assert.equal(
            await db.refreshToken.count({
              where: { user: { email: { in: [...fixtureEmails] } } },
            }),
            before,
          );
        },
      );
      await t.test(
        'login normalizes email and returns safe session data',
        async () => {
          const result = await request<Session>('login', {
            email: ` ${credentials.email.toUpperCase()} `,
            password,
          });
          assert.equal(result.status, 200);
          session = result.body;
          assert.equal(session.user.id, registered.body.user.id);
          assert.equal(result.headers.get('cache-control'), 'no-store');
        },
      );
      await t.test(
        'unknown email and wrong password return the same generic 401',
        async () => {
          const wrong = await request('login', {
            email: credentials.email,
            password: 'a wrong long password',
          });
          const unknown = await request('login', {
            email: `${randomUUID()}@example.invalid`,
            password,
          });
          assert.equal(wrong.status, 401);
          assert.equal(unknown.status, 401);
          assert.deepEqual(wrong.body, unknown.body);
        },
      );
      await t.test(
        'inactive users cannot login, refresh, or use existing access tokens',
        async () => {
          await db.user.update({
            where: { id: session.user.id },
            data: { isActive: false },
          });
          try {
            assert.equal(
              (await request('login', { email: credentials.email, password }))
                .status,
              401,
            );
            assert.equal(
              (await request('me', undefined, session.accessToken)).status,
              401,
            );
            assert.equal(
              (await request('refresh', { refreshToken: session.refreshToken }))
                .status,
              401,
            );
          } finally {
            await db.user.update({
              where: { id: session.user.id },
              data: { isActive: true },
            });
          }
        },
      );
      await t.test(
        '/me returns only public user and explicit organization memberships',
        async () => {
          const me = await request<{
            user: PublicUser;
            memberships: Membership[];
          }>('me', undefined, session.accessToken);
          assert.equal(me.status, 200);
          assert.equal(me.body.user.id, session.user.id);
          assert.equal(me.body.memberships[0]!.membershipId, membershipId);
          assert.deepEqual(Object.keys(me.body).sort(), [
            'memberships',
            'user',
          ]);
        },
      );
      await t.test(
        'rotation revokes the old token and its access session, while rejecting replay',
        async () => {
          const previous = session;
          const result = await request<Session>('refresh', {
            refreshToken: previous.refreshToken,
          });
          assert.equal(result.status, 200);
          session = result.body;
          assert.ok(session.refreshToken !== previous.refreshToken);
          assert.ok(session.accessToken !== previous.accessToken);
          assert.equal(
            (await request('refresh', { refreshToken: previous.refreshToken }))
              .status,
            401,
          );
          assert.equal(
            (await request('me', undefined, previous.accessToken)).status,
            401,
          );
          assert.equal(
            (await request('me', undefined, session.accessToken)).status,
            200,
          );
          const old = await db.refreshToken.findUniqueOrThrow({
            where: {
              tokenHash: createHash('sha256')
                .update(previous.refreshToken)
                .digest('hex'),
            },
          });
          assert.ok(old.revokedAt);
        },
      );
      await t.test('concurrent rotation has exactly one winner', async () => {
        const token = session.refreshToken;
        const results = await Promise.all([
          request<Session>('refresh', { refreshToken: token }),
          request<Session>('refresh', { refreshToken: token }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
        session = results.find((r) => r.status === 200)!.body;
        assert.equal(
          (await request('me', undefined, session.accessToken)).status,
          200,
        );
      });
      await t.test(
        'failed rotation rolls back revocation of the current token',
        async () => {
          const stub = mock.method(jwt, 'signAsync', async () => {
            throw new Error('private signing failure');
          });
          try {
            assert.equal(
              (await request('refresh', { refreshToken: session.refreshToken }))
                .status,
              500,
            );
          } finally {
            stub.mock.restore();
          }
          const result = await request<Session>('refresh', {
            refreshToken: session.refreshToken,
          });
          assert.equal(result.status, 200);
          session = result.body;
        },
      );
      await t.test(
        'expired and random refresh tokens are rejected',
        async () => {
          const login = await request<Session>('login', {
            email: credentials.email,
            password,
          });
          await db.refreshToken.update({
            where: {
              tokenHash: createHash('sha256')
                .update(login.body.refreshToken)
                .digest('hex'),
            },
            data: {
              createdAt: new Date(Date.now() - 172800000),
              expiresAt: new Date(Date.now() - 86400000),
            },
          });
          assert.equal(
            (
              await request('refresh', {
                refreshToken: login.body.refreshToken,
              })
            ).status,
            401,
          );
          assert.equal(
            (await request('me', undefined, login.body.accessToken)).status,
            401,
          );
          assert.equal(
            (
              await request('refresh', {
                refreshToken: randomBytes(48).toString('base64url'),
              })
            ).status,
            401,
          );
        },
      );
      await t.test(
        'logout is idempotent and revokes both refresh and access without deleting history',
        async () => {
          const login = await request<Session>('login', {
            email: credentials.email,
            password,
          });
          const token = login.body.refreshToken;
          assert.equal(
            (await request('logout', { refreshToken: token })).status,
            204,
          );
          assert.equal(
            (await request('logout', { refreshToken: token })).status,
            204,
          );
          assert.equal(
            (
              await request('logout', {
                refreshToken: randomBytes(48).toString('base64url'),
              })
            ).status,
            204,
          );
          assert.equal(
            (await request('refresh', { refreshToken: token })).status,
            401,
          );
          assert.equal(
            (await request('me', undefined, login.body.accessToken)).status,
            401,
          );
          assert.ok(
            (
              await db.refreshToken.findUniqueOrThrow({
                where: {
                  tokenHash: createHash('sha256').update(token).digest('hex'),
                },
              })
            ).revokedAt,
          );
        },
      );
      await t.test(
        'invalid, missing, expired, wrong-algorithm, and sessionless JWTs are rejected',
        async () => {
          const claims = jwt.decode<{ sub: string; sid: string }>(
            session.accessToken,
          );
          const decoded = { sub: claims.sub, sid: claims.sid };
          const tokens = [
            undefined,
            'invalid.jwt.value',
            await jwt.signAsync(decoded, { expiresIn: -1 }),
            await jwt.signAsync(decoded, { algorithm: 'HS384' }),
            await jwt.signAsync({ sub: session.user.id }),
            await jwt.signAsync({ sub: session.user.id, sid: randomUUID() }),
          ];
          for (const token of tokens)
            assert.equal((await request('me', undefined, token)).status, 401);
        },
      );
      await t.test(
        'organization context requires a valid UUID header and current membership',
        async () => {
          assert.equal(
            (await request('context', undefined, session.accessToken)).status,
            400,
          );
          assert.equal(
            (
              await request(
                'context',
                undefined,
                session.accessToken,
                'not-a-uuid',
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                'context',
                undefined,
                session.accessToken,
                `${organizationId},${organizationId}`,
              )
            ).status,
            400,
          );
          const context = await request<TenantContext>(
            'context',
            undefined,
            session.accessToken,
            organizationId,
          );
          assert.equal(context.status, 200);
          assert.deepEqual(context.body, {
            userId: session.user.id,
            organizationId,
            membershipId,
            role: 'OWNER',
          });
        },
      );
      const foreignInput = input('foreign');
      const foreign = (await request<Session>('register', foreignInput)).body;
      const foreignId = foreign.memberships[0]!.organizationId;
      await t.test(
        'a valid user cannot access another organization or a nonexistent organization',
        async () => {
          assert.equal(
            (
              await request(
                'context',
                undefined,
                session.accessToken,
                foreignId,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                'context',
                undefined,
                session.accessToken,
                randomUUID(),
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        'explicit roles have no implicit hierarchy; role downgrade takes effect immediately',
        async () => {
          for (const role of [
            'OWNER',
            'ADMIN',
            'MANAGER',
            'AGENT',
            'VIEWER',
          ] as const) {
            await db.organizationMember.update({
              where: { id: membershipId },
              data: { role },
            });
            assert.equal(
              (
                await request(
                  'owner-only',
                  undefined,
                  session.accessToken,
                  organizationId,
                )
              ).status,
              role === 'OWNER' ? 200 : 403,
            );
            const current = await request<TenantContext>(
              'context',
              undefined,
              session.accessToken,
              organizationId,
            );
            assert.equal(current.body.role, role);
          }
          const claims = jwt.decode<{ sub: string; sid: string }>(
            session.accessToken,
          );
          const identity = { sub: claims.sub, sid: claims.sid };
          const forgedClaims = await jwt.signAsync({
            ...identity,
            role: 'OWNER',
            organizationId,
          });
          assert.equal(
            (
              await request(
                'owner-only',
                undefined,
                forgedClaims,
                organizationId,
              )
            ).status,
            403,
          );
          await db.organizationMember.update({
            where: { id: membershipId },
            data: { role: 'OWNER' },
          });
        },
      );
      await t.test(
        'membership removal immediately blocks an existing access token',
        async () => {
          await db.organizationMember.delete({ where: { id: membershipId } });
          assert.equal(
            (
              await request(
                'context',
                undefined,
                session.accessToken,
                organizationId,
              )
            ).status,
            403,
          );
          const me = await request<{ memberships: Membership[] }>(
            'me',
            undefined,
            session.accessToken,
          );
          assert.equal(me.status, 200);
          assert.equal(me.body.memberships.length, 0);
          await db.organizationMember.create({
            data: {
              id: membershipId,
              userId: session.user.id,
              organizationId,
              role: 'OWNER',
            },
          });
        },
      );
      await t.test(
        'multiple memberships are returned without choosing an organization',
        async () => {
          await db.organizationMember.create({
            data: {
              userId: session.user.id,
              organizationId: foreignId,
              role: 'VIEWER',
            },
          });
          const login = await request<Session>('login', {
            email: credentials.email,
            password,
          });
          assert.equal(login.status, 200);
          assert.equal(login.body.memberships.length, 2);
          assert.equal('organizationId' in login.body, false);
          assert.equal(
            (
              await request(
                'owner-only',
                undefined,
                login.body.accessToken,
                foreignId,
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        'malformed, oversized, and unexpected body values are rejected without leaking values',
        async () => {
          const valid = input('invalid');
          for (const bad of [
            null,
            [],
            'string',
            { ...valid, email: 'bad' },
            { ...valid, email: 42 },
            { ...valid, password: 'short' },
            { ...valid, password: 'x'.repeat(129) },
            { ...valid, password: 42 },
            { ...valid, name: ' ' },
            { ...valid, organizationName: 'x'.repeat(101) },
            { ...valid, role: 'OWNER' },
            { ...valid, isActive: true },
          ]) {
            assert.equal((await request('register', bad)).status, 400);
          }
          for (const path of ['refresh', 'logout']) {
            for (const bad of [
              {},
              { refreshToken: 42 },
              { refreshToken: 'short' },
              { refreshToken: 'x'.repeat(65) },
              { refreshToken: session.refreshToken, userId: session.user.id },
            ]) {
              assert.equal((await request(path, bad)).status, 400);
            }
          }
          assert.equal(
            (
              await request('login', {
                email: credentials.email,
                password,
                unexpected: true,
              })
            ).status,
            400,
          );
          assert.equal(
            await db.user.count({ where: { email: valid.email } }),
            0,
          );
        },
      );
      await t.test(
        'deleted user cannot reuse a previously valid access JWT',
        async () => {
          const deleted = (await request<Session>('register', input('deleted')))
            .body;
          await db.refreshToken.deleteMany({
            where: { userId: deleted.user.id },
          });
          await db.organizationMember.deleteMany({
            where: { userId: deleted.user.id },
          });
          await db.user.delete({ where: { id: deleted.user.id } });
          assert.equal(
            (await request('me', undefined, deleted.accessToken)).status,
            401,
          );
        },
      );
      await t.test(
        'active login sessions are bounded; oldest sessions are revoked',
        async () => {
          const oldest = await request<Session>('login', {
            email: credentials.email,
            password,
          });
          for (let index = 0; index < 10; index++)
            assert.equal(
              (await request('login', { email: credentials.email, password }))
                .status,
              200,
            );
          assert.equal(
            await db.refreshToken.count({
              where: {
                userId: session.user.id,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            }),
            10,
          );
          assert.equal(
            (await request('me', undefined, oldest.body.accessToken)).status,
            401,
          );
        },
      );
    } finally {
      try {
        const users = await db.user.findMany({
          where: { email: { in: [...fixtureEmails] } },
          select: { id: true },
        });
        const ids = users.map((user) => user.id);
        const organizations = await db.organization.findMany({
          where: { name: { in: [...organizationNames] } },
          select: { id: true },
        });
        const orgIds = organizations.map((organization) => organization.id);
        await db.$transaction(async (tx) => {
          await tx.refreshToken.deleteMany({ where: { userId: { in: ids } } });
          await tx.organizationMember.deleteMany({
            where: { userId: { in: ids }, organizationId: { in: orgIds } },
          });
          await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
          await tx.user.deleteMany({ where: { id: { in: ids } } });
        });
      } finally {
        await app.close();
      }
    }
  },
);
