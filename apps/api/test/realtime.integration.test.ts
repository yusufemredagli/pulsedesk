import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { configureRealtime } from '../src/modules/realtime/realtime-adapter';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RealtimeRoomService } from '../src/modules/realtime/realtime-room.service';
import { RealtimeAuthService } from '../src/modules/realtime/realtime-auth.service';
import type { RealtimeSocket } from '../src/modules/realtime/realtime-context';
import {
  REALTIME,
  type JoinResult,
  type LeaveResult,
} from '../src/modules/realtime/realtime-events';
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'authenticated tenant-aware Socket.IO transport with PostgreSQL',
  { skip: !databaseUrl && 'Set dedicated TEST_DATABASE_URL' },
  async (t) => {
    const db = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RealtimeDispatchRuntime)
      .useValue({})
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureRealtime(app);
    const users: string[] = [],
      organizations: string[] = [];
    const clients: Socket[] = [];
    try {
      await app.listen(0, '127.0.0.1');
      const jwt = app.get(JwtService);
      const gateway = app.get(RealtimeGateway);
      const rooms = app.get(RealtimeRoomService);
      async function organization() {
        const org = await db.organization.create({
          data: { name: 'Realtime Fixture', slug: `realtime-${randomUUID()}` },
        });
        organizations.push(org.id);
        return org;
      }
      async function actor(orgId?: string) {
        const user = await db.user.create({
          data: {
            email: `${randomUUID()}@example.invalid`,
            name: 'Realtime fixture',
            passwordHash: 'unused-test-only',
          },
        });
        users.push(user.id);
        const session = await db.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: randomBytes(32).toString('hex'),
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        const membership = orgId
          ? await db.organizationMember.create({
              data: { userId: user.id, organizationId: orgId, role: 'OWNER' },
            })
          : null;
        return {
          user,
          session,
          membership,
          token: await jwt.signAsync({ sub: user.id, sid: session.id }),
        };
      }
      const first = await organization(),
        second = await organization(),
        foreign = await organization();
      const owner = await actor(first.id);
      const secondMembership = await db.organizationMember.create({
        data: {
          userId: owner.user.id,
          organizationId: second.id,
          role: 'AGENT',
        },
      });
      const url = `${await app.getUrl()}${REALTIME.NAMESPACE}`;
      function client(auth: unknown, origin?: string) {
        const socket = io(url, {
          autoConnect: false,
          transports: ['websocket'],
          reconnection: false,
          timeout: 2500,
          auth: auth as Record<string, unknown>,
          ...(origin ? { extraHeaders: { origin } } : {}),
        });
        clients.push(socket);
        return socket;
      }
      function connect(socket: Socket): Promise<void> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Realtime ready timed out')),
            4000,
          );
          socket.once(REALTIME.READY, (data) => {
            clearTimeout(timer);
            assert.deepEqual(data, { ok: true });
            resolve();
          });
          socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          socket.connect();
        });
      }
      async function rejected(auth: unknown, code = 'UNAUTHENTICATED') {
        const socket = client(auth);
        await assert.rejects(
          connect(socket),
          (error: Error & { data?: { code?: string } }) => {
            assert.equal(error.data?.code, code);
            assert.ok(
              !/Prisma|stack|tokenHash|passwordHash|SELECT/.test(
                JSON.stringify(error.data),
              ),
            );
            return true;
          },
        );
        assert.equal(socket.connected, false);
        socket.disconnect();
      }
      function join(socket: Socket, payload: unknown): Promise<JoinResult> {
        return new Promise((resolve, reject) =>
          socket
            .timeout(2500)
            .emit(
              REALTIME.JOIN,
              payload,
              (error: Error | null, result: JoinResult) =>
                error ? reject(error) : resolve(result),
            ),
        );
      }
      function serverSocket(socket: Socket) {
        return gateway.server.sockets.get(socket.id!) as RealtimeSocket;
      }
      function assertRooms(socket: Socket, orgId?: string, memberId?: string) {
        const server = serverSocket(socket);
        assert.ok(server);
        assert.deepEqual(
          [...server.rooms].sort(),
          [
            socket.id!,
            ...(orgId ? [`org:${orgId}`, `member:${memberId}`] : []),
          ].sort(),
        );
      }
      const socket = client({ token: owner.token }, 'http://localhost:3000');
      await t.test(
        'valid authentication joins no tenant automatically and retains no raw token',
        async () => {
          await connect(socket);
          assertRooms(socket);
          assert.deepEqual(serverSocket(socket).handshake.auth, {});
          assert.equal(
            serverSocket(socket).data.identity!.userId,
            owner.user.id,
          );
          assert.ok(
            !JSON.stringify(serverSocket(socket).data.identity).includes(
              owner.token,
            ),
          );
        },
      );
      await t.test(
        'missing, malformed and client-supplied identity fields are rejected',
        async () => {
          await rejected({});
          await rejected({ token: 'bad.jwt' });
          await rejected({ token: owner.token, role: 'OWNER' });
          await rejected({ token: owner.token, organizationId: first.id });
        },
      );
      await t.test(
        'expired and incorrectly signed/claimed tokens are rejected',
        async () => {
          await rejected({
            token: await jwt.signAsync(
              { sub: owner.user.id, sid: owner.session.id },
              { expiresIn: -1 },
            ),
          });
          await rejected({
            token: await jwt.signAsync(
              { sub: owner.user.id, sid: owner.session.id },
              { audience: 'other' },
            ),
          });
          await rejected({
            token: await jwt.signAsync(
              { sub: owner.user.id, sid: owner.session.id },
              { issuer: 'other' },
            ),
          });
          await rejected({
            token: await jwt.signAsync(
              { sub: owner.user.id, sid: owner.session.id },
              { secret: randomBytes(48).toString('hex') },
            ),
          });
          await rejected({
            token: await jwt.signAsync({
              sub: randomUUID(),
              sid: owner.session.id,
            }),
          });
        },
      );
      await t.test(
        'revoked, expired, inactive and deleted session users cannot connect',
        async () => {
          const revoked = await actor();
          await db.refreshToken.update({
            where: { id: revoked.session.id },
            data: { revokedAt: new Date() },
          });
          await rejected({ token: revoked.token });
          const expired = await actor();
          await db.refreshToken.update({
            where: { id: expired.session.id },
            data: {
              expiresAt: new Date(Date.now() - 1000),
              createdAt: new Date(Date.now() - 2000),
            },
          });
          await rejected({ token: expired.token });
          const inactive = await actor();
          await db.user.update({
            where: { id: inactive.user.id },
            data: { isActive: false },
          });
          await rejected({ token: inactive.token });
          const deleted = await actor();
          await db.user.delete({ where: { id: deleted.user.id } });
          await rejected({ token: deleted.token });
        },
      );
      await t.test(
        'organization join acknowledges and emits verified context with actual tenant/member rooms',
        async () => {
          const emitted = new Promise((resolve) =>
            socket.once(REALTIME.JOINED, resolve),
          );
          const result = await join(socket, { organizationId: first.id });
          assert.deepEqual(result, {
            ok: true,
            organizationId: first.id,
            membershipId: owner.membership!.id,
            role: 'OWNER',
          });
          assert.deepEqual(await emitted, result);
          assertRooms(socket, first.id, owner.membership!.id);
        },
      );
      await t.test(
        'unknown and foreign organizations return identical failures and clear old context',
        async () => {
          const result = await join(socket, { organizationId: foreign.id });
          assert.deepEqual(result, {
            ok: false,
            code: 'ACCESS_DENIED',
            message: 'Access denied',
          });
          assert.deepEqual(
            await join(socket, { organizationId: randomUUID() }),
            result,
          );
          assertRooms(socket);
          assert.equal(serverSocket(socket).data.tenant, undefined);
        },
      );
      await t.test(
        'malformed and arbitrary room requests cannot join rooms',
        async () => {
          for (const payload of [
            null,
            [],
            'org:anything',
            {},
            { organizationId: 'bad' },
            { organizationId: first.id, room: `org:${foreign.id}` },
            { organizationId: first.id, role: 'ADMIN' },
          ]) {
            const result = await join(socket, payload);
            assert.equal(result.ok, false);
            if (!result.ok) assert.equal(result.code, 'INVALID_REQUEST');
            assertRooms(socket);
          }
          socket.emit('join', `org:${foreign.id}`);
          socket.emit('room:join', { room: `member:${secondMembership.id}` });
          await join(socket, { organizationId: first.id });
          assertRooms(socket, first.id, owner.membership!.id);
        },
      );
      await t.test(
        'role changes and removed membership are reflected on rejoin',
        async () => {
          await db.organizationMember.update({
            where: { id: owner.membership!.id },
            data: { role: 'VIEWER' },
          });
          const result = await join(socket, { organizationId: first.id });
          assert.ok(result.ok);
          assert.equal(result.role, 'VIEWER');
          await db.organizationMember.delete({
            where: { id: owner.membership!.id },
          });
          const denied = await join(socket, { organizationId: first.id });
          assert.equal(denied.ok, false);
          assertRooms(socket);
        },
      );
      await t.test(
        'organization switch leaves previous org/member rooms and explicit leave is idempotent',
        async () => {
          const newMember = await db.organizationMember.create({
            data: {
              userId: owner.user.id,
              organizationId: first.id,
              role: 'MANAGER',
            },
          });
          await join(socket, { organizationId: first.id });
          assertRooms(socket, first.id, newMember.id);
          const left = new Promise((resolve) =>
            socket.once(REALTIME.LEFT, resolve),
          );
          await join(socket, { organizationId: second.id });
          assert.deepEqual(await left, { ok: true, organizationId: first.id });
          assertRooms(socket, second.id, secondMembership.id);
          for (const organizationId of [second.id, null]) {
            const result = await new Promise<LeaveResult>((resolve, reject) =>
              socket
                .timeout(2500)
                .emit(
                  REALTIME.LEAVE,
                  (error: Error | null, value: LeaveResult) =>
                    error ? reject(error) : resolve(value),
                ),
            );
            assert.deepEqual(result, { ok: true, organizationId });
            assertRooms(socket);
          }
        },
      );
      await t.test(
        'live helper refreshes roles and removes invalid authorization from existing sockets',
        async () => {
          await join(socket, { organizationId: second.id });
          await db.organizationMember.update({
            where: { id: secondMembership.id },
            data: { role: 'MANAGER' },
          });
          assert.equal(
            (await rooms.revalidate(serverSocket(socket))).role,
            'MANAGER',
          );
          await db.organizationMember.delete({
            where: { id: secondMembership.id },
          });
          await assert.rejects(rooms.revalidate(serverSocket(socket)));
          assertRooms(socket);
          await db.organizationMember.create({
            data: {
              userId: owner.user.id,
              organizationId: second.id,
              role: 'AGENT',
            },
          });
          await join(socket, { organizationId: second.id });
          await db.refreshToken.update({
            where: { id: owner.session.id },
            data: { revokedAt: new Date() },
          });
          const result = await join(socket, { organizationId: second.id });
          assert.equal(result.ok, false);
          if (!result.ok) assert.equal(result.code, 'UNAUTHENTICATED');
          assertRooms(socket);
          await db.refreshToken.update({
            where: { id: owner.session.id },
            data: { revokedAt: null },
          });
        },
      );
      await t.test(
        'concurrent joins are bounded and disconnect removes context and rooms',
        async () => {
          const auth = app.get(RealtimeAuthService);
          const original = auth.membership.bind(auth);
          let release!: () => void, started!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const entered = new Promise<void>((resolve) => {
            started = resolve;
          });
          const stub = mock.method(
            auth,
            'membership',
            async (...args: Parameters<typeof original>) => {
              started();
              await gate;
              return original(...args);
            },
          );
          const pending = join(socket, { organizationId: second.id });
          await entered;
          const busy = await join(socket, { organizationId: first.id });
          assert.deepEqual(busy, {
            ok: false,
            code: 'BUSY',
            message: 'Request already in progress',
          });
          release();
          assert.equal((await pending).ok, true);
          stub.mock.restore();
          const server = serverSocket(socket);
          const timer = server.data.expiryTimer;
          const disconnected = new Promise<void>((resolve) =>
            server.once('disconnect', () => resolve()),
          );
          socket.disconnect();
          await disconnected;
          assert.deepEqual(server.data, {});
          assert.equal(server.rooms.size, 0);
          assert.equal(gateway.server.sockets.has(server.id), false);
          assert.ok(timer);
        },
      );
      await t.test(
        'disconnect while a membership lookup is pending cannot restore context or rooms',
        async () => {
          const current = client({ token: owner.token });
          await connect(current);
          const server = serverSocket(current);
          const auth = app.get(RealtimeAuthService);
          const original = auth.membership.bind(auth);
          let release!: () => void, entered!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const stub = mock.method(
            auth,
            'membership',
            async (...args: Parameters<typeof original>) => {
              entered();
              await gate;
              return original(...args);
            },
          );
          try {
            const pending = gateway.join(server, { organizationId: second.id });
            await started;
            const disconnected = new Promise<void>((resolve) =>
              server.once('disconnect', () => resolve()),
            );
            current.disconnect();
            await disconnected;
            release();
            assert.equal((await pending).ok, false);
            assert.equal(server.rooms.size, 0);
            assert.deepEqual(server.data, {});
          } finally {
            release();
            stub.mock.restore();
            current.disconnect();
          }
        },
      );
      await t.test(
        'connected sockets expire and release tenant context at access token expiry',
        async () => {
          const token = await jwt.signAsync(
            { sub: owner.user.id, sid: owner.session.id },
            { expiresIn: 2 },
          );
          const current = client({ token });
          await connect(current);
          await join(current, { organizationId: second.id });
          const server = serverSocket(current);
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Token expiry did not disconnect')),
              4000,
            );
            server.once('disconnect', () => {
              clearTimeout(timer);
              resolve();
            });
          });
          assert.equal(server.rooms.size, 0);
          assert.deepEqual(server.data, {});
        },
      );
      await t.test(
        'disallowed browser origin is rejected at websocket upgrade',
        async () => {
          const denied = client(
            { token: owner.token },
            'https://foreign.example',
          );
          await assert.rejects(connect(denied));
          denied.disconnect();
        },
      );
      await t.test(
        'oversized packets disconnect without changing tenant rooms',
        async () => {
          const oversized = client({ token: owner.token });
          await connect(oversized);
          const server = serverSocket(oversized);
          const disconnected = new Promise<void>((resolve) =>
            server.once('disconnect', () => resolve()),
          );
          oversized.emit(REALTIME.JOIN, { organizationId: 'x'.repeat(10000) });
          await disconnected;
          assert.equal(server.rooms.size, 0);
          assert.deepEqual(server.data, {});
        },
      );
      await t.test(
        'unexpected database failures return sanitized failure acknowledgements',
        async () => {
          const current = client({ token: owner.token });
          await connect(current);
          const stub = mock.method(
            app.get(RealtimeAuthService),
            'membership',
            async () => {
              throw new Error('sensitive database failure');
            },
          );
          try {
            assert.deepEqual(
              await join(current, { organizationId: second.id }),
              {
                ok: false,
                code: 'UNAVAILABLE',
                message: 'Realtime service unavailable',
              },
            );
            assertRooms(current);
          } finally {
            stub.mock.restore();
            current.disconnect();
          }
        },
      );
    } finally {
      for (const socket of clients) socket.disconnect();
      await db.refreshToken.deleteMany({ where: { userId: { in: users } } });
      await db.organizationMember.deleteMany({
        where: { organizationId: { in: organizations } },
      });
      await db.organization.deleteMany({
        where: { id: { in: organizations } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await app.close();
    }
  },
);
