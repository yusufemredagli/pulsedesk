import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import type { OrganizationRole } from '../src/generated/prisma/client';
type Actor = {
  userId: string;
  memberId: string;
  organizationId: string;
  token: string;
};
type RecordView = {
  id: string;
  name: string;
  updatedAt: string;
  statistics: {
    totalTickets: number;
    openTickets: number;
    activeTickets: number;
    lastActivityAt: string | null;
  };
};
type Page<T> = {
  data: T[];
  pagination: { total: number; page: number; totalPages: number };
};
type Ticket = {
  id: string;
  version: number;
  createdAt: string;
  status: string;
  sla: { id: string; type: string; dueAt: string }[];
};
type Policy = {
  id: string;
  updatedAt: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
  priority: string;
};
type Settings = {
  workspace: { id: string; name: string; slug: string; updatedAt: string };
  account: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    updatedAt: string;
  };
  role: string;
};
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'Phase 7 management routes preserve tenant scope, permissions, history and concurrent edits',
  { skip: !databaseUrl && 'Set a dedicated migrated TEST_DATABASE_URL' },
  async (t) => {
    const db = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(RealtimeDispatchRuntime)
      .useValue({})
      .compile();
    const app = module.createNestApplication({ logger: false });
    const orgIds: string[] = [],
      users: string[] = [];
    let base = '';
    async function actor(
      role: OrganizationRole,
      organizationId: string,
      active = true,
    ): Promise<Actor> {
      const user = await db.user.create({
        data: {
          name: `Fixture ${role}`,
          email: `${randomUUID()}@example.invalid`,
          passwordHash: 'test-only-no-login',
          isActive: active,
        },
      });
      users.push(user.id);
      const member = await db.organizationMember.create({
        data: { organizationId, userId: user.id, role },
      });
      const session = await db.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return {
        userId: user.id,
        memberId: member.id,
        organizationId,
        token: module.get(JwtService).sign({ sub: user.id, sid: session.id }),
      };
    }
    async function call<T = RecordView>(
      method: string,
      path: string,
      who: Actor,
      body?: unknown,
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          'x-organization-id': who.organizationId,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body:
          response.status === 204
            ? (null as T)
            : ((await response.json()) as T),
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (const label of ['A', 'B'])
        orgIds.push(
          (
            await db.organization.create({
              data: { name: `Phase7 ${label}`, slug: `phase7-${randomUUID()}` },
            })
          ).id,
        );
      const owner = await actor('OWNER', orgIds[0]!),
        admin = await actor('ADMIN', owner.organizationId),
        manager = await actor('MANAGER', owner.organizationId),
        agent = await actor('AGENT', owner.organizationId),
        viewer = await actor('VIEWER', owner.organizationId),
        inactive = await actor('AGENT', owner.organizationId, false),
        foreign = await actor('OWNER', orgIds[1]!);
      let customer: RecordView,
        team: RecordView,
        technical: RecordView,
        policy: Policy;
      await t.test(
        'customer list/search/sort/pagination and management permissions remain tenant scoped',
        async () => {
          customer = (
            await call('POST', '/customers', manager, {
              name: 'Alpha Customer',
              email: 'alpha@example.invalid',
              phone: '+90 312 555 10 01',
            })
          ).body;
          assert.ok(customer.id);
          assert.equal(
            (await call('POST', '/customers', owner, { name: 'Beta Customer' }))
              .status,
            201,
          );
          assert.equal(
            (
              await call('POST', '/customers', admin, {
                name: 'Gamma Customer',
              })
            ).status,
            201,
          );
          const foreignCustomer = (
            await call('POST', '/customers', foreign, {
              name: 'Foreign Customer',
            })
          ).body;
          const list = await call<Page<RecordView>>(
            'GET',
            '/customers?sort=name:asc&limit=1&page=2',
            viewer,
          );
          assert.equal(list.status, 200);
          assert.equal(list.body.pagination.total, 3);
          assert.equal(list.body.data[0]!.name, 'Beta Customer');
          assert.equal(
            (
              await call<Page<RecordView>>(
                'GET',
                '/customers?search=alpha%40example.invalid',
                agent,
              )
            ).body.data[0]!.id,
            customer.id,
          );
          assert.equal(
            (
              await call<Page<RecordView>>(
                'GET',
                '/customers?search=%25',
                owner,
              )
            ).body.pagination.total,
            0,
          );
          assert.equal(
            (await call('GET', '/customers?sort=passwordHash:asc', owner))
              .status,
            400,
          );
          for (const who of [agent, viewer]) {
            assert.equal(
              (await call('POST', '/customers', who, { name: 'Denied' }))
                .status,
              403,
            );
            assert.equal(
              (
                await call('PATCH', `/customers/${customer.id}`, who, {
                  name: 'Denied',
                })
              ).status,
              403,
            );
          }
          assert.equal(
            (await call('GET', `/customers/${foreignCustomer.id}`, owner))
              .status,
            404,
          );
          assert.equal(
            (
              await call('PATCH', `/customers/${foreignCustomer.id}`, owner, {
                name: 'Denied',
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await call('PATCH', `/customers/${customer.id}`, manager, {
                organizationId: foreign.organizationId,
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        'customer updates use timestamp tokens and reject concurrent stale edits',
        async () => {
          customer = (await call('GET', `/customers/${customer.id}`, owner))
            .body;
          const updates = await Promise.all(
            ['Alpha Updated', 'Alpha Revised'].map((name) =>
              call('PATCH', `/customers/${customer.id}`, manager, {
                name,
                expectedUpdatedAt: customer.updatedAt,
              }),
            ),
          );
          assert.deepEqual(updates.map((row) => row.status).sort(), [200, 409]);
          const current = (
            await call('GET', `/customers/${customer.id}`, owner)
          ).body;
          assert.ok(
            Date.parse(current.updatedAt) > Date.parse(customer.updatedAt),
          );
          assert.equal(
            (
              await call('PATCH', `/customers/${customer.id}`, owner, {
                name: 'Stale',
                expectedUpdatedAt: customer.updatedAt,
              })
            ).status,
            409,
          );
          customer = current;
        },
      );
      await t.test(
        'team creation/rename and paginated member roles enforce active same-tenant membership and duplicates',
        async () => {
          team = (
            await call('POST', '/teams', manager, { name: 'Customer Response' })
          ).body;
          technical = (
            await call('POST', '/teams', owner, { name: 'Technical Response' })
          ).body;
          assert.equal(
            (
              await call('POST', '/teams', manager, {
                name: 'Customer Response',
              })
            ).status,
            409,
          );
          const foreignTeam = (
            await call('POST', '/teams', foreign, { name: 'Foreign Team' })
          ).body;
          assert.equal(
            (await call('GET', `/teams/${foreignTeam.id}`, owner)).status,
            404,
          );
          assert.equal(
            (await call('GET', `/teams/${foreignTeam.id}/members`, owner))
              .status,
            404,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, agent, {
                membershipId: agent.memberId,
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, owner, {
                membershipId: foreign.memberId,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, manager, {
                membershipId: inactive.memberId,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, manager, {
                membershipId: agent.memberId,
                expectedUpdatedAt: team.updatedAt,
              })
            ).status,
            201,
          );
          const after = (await call('GET', `/teams/${team.id}`, owner)).body;
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, owner, {
                membershipId: agent.memberId,
                expectedUpdatedAt: after.updatedAt,
              })
            ).status,
            409,
          );
          assert.equal(
            (await call('GET', `/teams/${team.id}`, owner)).body.updatedAt,
            after.updatedAt,
          );
          const members = await call<
            Page<{ membershipId: string; role: string; isActive: boolean }>
          >('GET', `/teams/${team.id}/members?limit=1&search=AGENT`, viewer);
          assert.equal(members.body.pagination.total, 1);
          assert.equal(members.body.data[0]!.role, 'AGENT');
          assert.equal(members.body.data[0]!.isActive, true);
          assert.equal(
            (
              await call('PATCH', `/teams/${team.id}`, manager, {
                name: 'Response Updated',
                expectedUpdatedAt: team.updatedAt,
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await call('PATCH', `/teams/${team.id}`, manager, {
                name: 'Response Updated',
                expectedUpdatedAt: after.updatedAt,
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${agent.memberId}`,
                viewer,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${agent.memberId}?expectedUpdatedAt=${encodeURIComponent(after.updatedAt)}`,
                manager,
              )
            ).status,
            409,
          );
          const fresh = (await call('GET', `/teams/${team.id}`, owner)).body;
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${agent.memberId}?expectedUpdatedAt=${encodeURIComponent(fresh.updatedAt)}`,
                manager,
              )
            ).status,
            204,
          );
          assert.equal(
            (
              await call<Page<unknown>>(
                'GET',
                `/teams/${team.id}/members`,
                agent,
              )
            ).body.pagination.total,
            0,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, manager, {
                membershipId: agent.memberId,
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await call('POST', `/teams/${technical.id}/members`, owner, {
                membershipId: manager.memberId,
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await call('PATCH', `/teams/${team.id}`, agent, {
                name: 'Denied',
              })
            ).status,
            403,
          );
        },
      );
      await t.test(
        'SLA creation/filtering/duration validation and activation remain owner/admin only',
        async () => {
          const body = {
            name: 'High response',
            priority: 'HIGH',
            firstResponseMinutes: 30,
            resolutionMinutes: 240,
            isActive: true,
          };
          for (const who of [manager, agent, viewer])
            assert.equal(
              (await call('POST', '/sla/policies', who, body)).status,
              403,
            );
          const created = await call<Policy>(
            'POST',
            '/sla/policies',
            owner,
            body,
          );
          assert.equal(created.status, 201);
          policy = created.body;
          assert.equal(
            (await call('POST', '/sla/policies', admin, body)).status,
            409,
          );
          for (const value of [0, -1, 1.5, 525601])
            assert.equal(
              (
                await call('PATCH', `/sla/policies/${policy.id}`, owner, {
                  firstResponseMinutes: value,
                })
              ).status,
              400,
            );
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, manager, {
                isActive: false,
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await call<Page<Policy>>(
                'GET',
                '/sla/policies?priority=HIGH',
                viewer,
              )
            ).body.pagination.total,
            1,
          );
          assert.equal(
            (
              await call<Page<Policy>>(
                'GET',
                '/sla/policies?priority=LOW',
                agent,
              )
            ).body.pagination.total,
            0,
          );
          assert.equal(
            (await call('GET', '/sla/policies?priority=bad', owner)).status,
            400,
          );
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, foreign, {
                isActive: false,
              })
            ).status,
            404,
          );
        },
      );
      const tickets: Ticket[] = [];
      async function create() {
        const response = await call<Ticket>('POST', '/tickets', manager, {
          customerId: customer.id,
          subject: 'Scoped support',
          description: 'Phase 7 test',
          priority: 'HIGH',
          source: 'WEB',
        });
        assert.equal(response.status, 201);
        return response.body;
      }
      async function command(
        ticket: Ticket,
        action: string,
        who: Actor,
        extra: Record<string, unknown> = {},
      ) {
        const response = await call<Ticket>(
          'POST',
          `/tickets/${ticket.id}/${action}`,
          who,
          { expectedVersion: ticket.version, ...extra },
        );
        assert.equal(response.status, 200);
        return response.body;
      }
      await t.test(
        'customer/team counts and latest comment activity match accessible ticket/history scope',
        async () => {
          tickets.push(await create());
          let assigned = await command(await create(), 'triage', manager);
          assigned = await command(assigned, 'assign', manager, {
            assignedTeamId: team.id,
            assignedMemberId: agent.memberId,
          });
          tickets.push(assigned);
          let active = await command(await create(), 'triage', manager);
          active = await command(active, 'assign', manager, {
            assignedTeamId: technical.id,
            assignedMemberId: manager.memberId,
          });
          active = await command(active, 'start', manager);
          tickets.push(active);
          let resolved = await command(await create(), 'triage', manager);
          resolved = await command(resolved, 'assign', manager, {
            assignedTeamId: team.id,
            assignedMemberId: agent.memberId,
          });
          resolved = await command(resolved, 'start', agent);
          resolved = await command(resolved, 'resolve', agent);
          tickets.push(resolved);
          const visibleComment = await call<{ createdAt: string }>(
            'POST',
            `/tickets/${assigned.id}/comments`,
            agent,
            { body: 'Visible activity', visibility: 'INTERNAL' },
          );
          assert.equal(visibleComment.status, 201);
          const hiddenComment = await call<{ createdAt: string }>(
            'POST',
            `/tickets/${active.id}/comments`,
            manager,
            { body: 'Restricted activity', visibility: 'INTERNAL' },
          );
          assert.equal(hiddenComment.status, 201);
          const full = (await call('GET', `/customers/${customer.id}`, owner))
              .body.statistics,
            limited = (await call('GET', `/customers/${customer.id}`, agent))
              .body.statistics;
          assert.deepEqual(
            [full.totalTickets, full.openTickets, full.activeTickets],
            [4, 3, 1],
          );
          assert.deepEqual(
            [limited.totalTickets, limited.openTickets, limited.activeTickets],
            [2, 1, 0],
          );
          assert.equal(full.lastActivityAt, hiddenComment.body.createdAt);
          assert.equal(limited.lastActivityAt, visibleComment.body.createdAt);
          assert.deepEqual(
            (
              await call(
                'GET',
                `/customers/${customer.id.toUpperCase()}`,
                agent,
              )
            ).body.statistics,
            limited,
          );
          assert.deepEqual(
            (await call('GET', `/teams/${team.id.toUpperCase()}`, agent)).body
              .statistics,
            (await call('GET', `/teams/${team.id}`, agent)).body.statistics,
          );

          const listed = await call<Page<RecordView>>(
            'GET',
            '/customers?search=' + encodeURIComponent(customer.name),
            agent,
          );
          assert.deepEqual(listed.body.data[0]!.statistics, limited);
          const ownTeam = (await call('GET', `/teams/${team.id}`, agent)).body
              .statistics,
            otherTeam = (await call('GET', `/teams/${technical.id}`, agent))
              .body.statistics;
          assert.equal(ownTeam.totalTickets, 2);
          assert.equal(ownTeam.openTickets, 1);
          assert.equal(otherTeam.totalTickets, 0);
          assert.equal(
            (await call('GET', `/teams/${technical.id}`, owner)).body.statistics
              .activeTickets,
            1,
          );
          assert.equal(
            (
              await call<Page<Ticket>>(
                'GET',
                `/tickets?customerId=${customer.id}&limit=1&page=2`,
                agent,
              )
            ).body.pagination.total,
            2,
          );
          assert.equal(
            (
              await call<Page<Ticket>>(
                'GET',
                `/tickets?assignedTeamId=${team.id}&activeOnly=true`,
                owner,
              )
            ).body.pagination.total,
            1,
          );
          assert.equal(
            (await call('GET', '/tickets?activeOnly=invalid', owner)).status,
            400,
          );
        },
      );
      await t.test(
        'policy updates retain historical deadlines and only affect newly-created tickets',
        async () => {
          const before = await db.slaEvent.findMany({
            where: { organizationId: owner.organizationId },
            orderBy: { id: 'asc' },
          });
          const updated = await call<Policy>(
            'PATCH',
            `/sla/policies/${policy.id}`,
            admin,
            {
              firstResponseMinutes: 45,
              resolutionMinutes: 300,
              expectedUpdatedAt: policy.updatedAt,
            },
          );
          assert.equal(updated.status, 200);
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, owner, {
                isActive: false,
                expectedUpdatedAt: policy.updatedAt,
              })
            ).status,
            409,
          );
          policy = updated.body;
          assert.deepEqual(
            (
              await db.slaEvent.findMany({
                where: { organizationId: owner.organizationId },
                orderBy: { id: 'asc' },
              })
            ).map((row) => [row.id, row.dueAt.toISOString()]),
            before.map((row) => [row.id, row.dueAt.toISOString()]),
          );
          const fresh = await create();
          const detail = await call<Ticket>(
            'GET',
            `/tickets/${fresh.id}`,
            owner,
          );
          assert.equal(
            Date.parse(
              detail.body.sla.find((row) => row.type === 'FIRST_RESPONSE')!
                .dueAt,
            ) - Date.parse(fresh.createdAt),
            45 * 60000,
          );
          const inactivePolicy = await call<Policy>(
            'PATCH',
            `/sla/policies/${policy.id}`,
            owner,
            { isActive: false, expectedUpdatedAt: policy.updatedAt },
          );
          assert.equal(inactivePolicy.status, 200);
          policy = inactivePolicy.body;
          const noPolicy = await create();
          assert.equal(
            (await call<Ticket>('GET', `/tickets/${noPolicy.id}`, owner)).body
              .sla.length,
            0,
          );
          const enabled = await call<Policy>(
            'PATCH',
            `/sla/policies/${policy.id}`,
            owner,
            { isActive: true, expectedUpdatedAt: policy.updatedAt },
          );
          assert.equal(enabled.status, 200);
          policy = enabled.body;
        },
      );
      await t.test(
        'settings exposes only safe scoped fields and workspace renames require owner/admin with concurrency',
        async () => {
          const response = await call<Settings>('GET', '/settings', owner);
          assert.equal(response.status, 200);
          const settings = response.body;
          assert.deepEqual(Object.keys(settings).sort(), [
            'account',
            'role',
            'workspace',
          ]);
          assert.deepEqual(Object.keys(settings.account).sort(), [
            'email',
            'id',
            'isActive',
            'name',
            'updatedAt',
          ]);
          assert.deepEqual(Object.keys(settings.workspace).sort(), [
            'id',
            'name',
            'slug',
            'updatedAt',
          ]);
          for (const who of [manager, agent, viewer])
            assert.equal(
              (
                await call('PATCH', '/settings/workspace', who, {
                  name: 'Denied',
                  expectedUpdatedAt: settings.workspace.updatedAt,
                })
              ).status,
              403,
            );
          const changed = await call('PATCH', '/settings/workspace', admin, {
            name: 'Renamed workspace',
            expectedUpdatedAt: settings.workspace.updatedAt,
          });
          assert.equal(changed.status, 200);
          assert.equal(
            (
              await call('PATCH', '/settings/workspace', owner, {
                name: 'Stale',
                expectedUpdatedAt: settings.workspace.updatedAt,
              })
            ).status,
            409,
          );
          assert.notEqual(
            (await call<Settings>('GET', '/settings', foreign)).body.workspace
              .name,
            'Renamed workspace',
          );
          assert.equal(
            (
              await call('PATCH', '/settings/workspace', owner, {
                name: 'Invalid',
                slug: 'changed',
                expectedUpdatedAt: changed.body.updatedAt,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await call('PATCH', '/settings/workspace', owner, {
                name: 'Missing version',
              })
            ).status,
            400,
          );
          assert.equal((await fetch(base + '/settings')).status, 401);
        },
      );
      await t.test(
        'self account names can change for all members; email, role and other-user writes are rejected',
        async () => {
          for (const who of [owner, admin, manager, agent, viewer]) {
            const before = (await call<Settings>('GET', '/settings', who)).body;
            const response = await call<Settings['account']>(
              'PATCH',
              '/settings/account',
              who,
              {
                name: 'Updated profile',
                expectedUpdatedAt: before.account.updatedAt,
              },
            );
            assert.equal(response.status, 200);
            assert.equal(response.body.id, who.userId);
            assert.equal(response.body.name, 'Updated profile');
            assert.equal(response.body.email, before.account.email);
            assert.equal(
              (
                await call('PATCH', '/settings/account', who, {
                  name: 'Stale',
                  expectedUpdatedAt: before.account.updatedAt,
                })
              ).status,
              409,
            );
            for (const extra of [
              { email: 'hijack@example.invalid' },
              { userId: foreign.userId },
              { role: 'OWNER' },
              { isActive: false },
            ])
              assert.equal(
                (
                  await call('PATCH', '/settings/account', who, {
                    name: 'Denied',
                    expectedUpdatedAt: response.body.updatedAt,
                    ...extra,
                  })
                ).status,
                400,
              );
          }
          const current = (await call<Settings>('GET', '/settings', manager))
            .body;
          const simultaneous = await Promise.all(
            ['Concurrent One', 'Concurrent Two'].map((name) =>
              call('PATCH', '/settings/account', manager, {
                name,
                expectedUpdatedAt: current.account.updatedAt,
              }),
            ),
          );
          assert.deepEqual(
            simultaneous.map((row) => row.status).sort(),
            [200, 409],
          );
        },
      );
    } finally {
      await db.$transaction(async (tx) => {
        const where = { organizationId: { in: orgIds } };
        await tx.outboxEvent.deleteMany({ where });
        await tx.notification.deleteMany({ where });
        await tx.slaEvent.deleteMany({ where });
        await tx.ticketComment.deleteMany({ where });
        await tx.ticketStatusHistory.deleteMany({ where });
        await tx.ticketAssignment.deleteMany({ where });
        await tx.auditLog.deleteMany({ where });
        await tx.ticket.deleteMany({ where });
        await tx.slaPolicy.deleteMany({ where });
        await tx.organizationTicketCounter.deleteMany({ where });
        await tx.teamMember.deleteMany({ where });
        await tx.team.deleteMany({ where });
        await tx.customer.deleteMany({ where });
        await tx.organizationMember.deleteMany({ where });
        await tx.refreshToken.deleteMany({ where: { userId: { in: users } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
      await app.close();
    }
  },
);
