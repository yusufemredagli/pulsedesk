import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { OrganizationRole } from '../src/generated/prisma/client';
interface Actor {
  userId: string;
  memberId: string;
  organizationId: string;
  token: string;
}
interface Resource {
  id: string;
  name: string;
}
interface Ticket {
  id: string;
  version: number;
  ticketNumber: number;
  reference: string;
  status: string;
  subject: string;
  priority: string;
  assignedTeam: { id: string } | null;
  assignedMember: { membershipId: string } | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: Array<{ id: string; body: string; visibility: string }>;
  statusHistory: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
  assignmentHistory: Array<{ id: string }>;
}
interface Page<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'tenant-safe support operations, lifecycle, auditing and concurrency over HTTP',
  {
    skip:
      !databaseUrl &&
      'Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database',
  },
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
    const fixture = randomUUID();
    const userIds: string[] = [];
    const orgIds: string[] = [];
    async function actor(
      role: OrganizationRole,
      organizationId: string,
    ): Promise<Actor> {
      const user = await db.user.create({
        data: {
          name: `Fixture ${role}`,
          email: `${randomUUID()}@example.invalid`,
          passwordHash: 'test-only-no-login',
        },
      });
      userIds.push(user.id);
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
        token: await app
          .get(JwtService)
          .signAsync({ sub: user.id, sid: session.id }),
      };
    }
    async function call<T = Resource>(
      method: string,
      path: string,
      who: Actor,
      body?: unknown,
    ) {
      const response = await fetch(`${await app.getUrl()}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          'x-organization-id': who.organizationId,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json: unknown =
        response.status === 204 ? null : await response.json();
      assert.ok(
        !/passwordHash|tokenHash|JWT_ACCESS_SECRET|PrismaClient|"stack"/.test(
          JSON.stringify(json),
        ),
      );
      return { status: response.status, body: json as T };
    }
    try {
      await app.listen(0, '127.0.0.1');
      for (const name of ['A', 'B']) {
        const org = await db.organization.create({
          data: {
            name: `ops-${fixture}-${name}`,
            slug: `ops-${fixture}-${name}`,
          },
        });
        orgIds.push(org.id);
      }
      const owner = await actor('OWNER', orgIds[0]!);
      const foreign = await actor('OWNER', orgIds[1]!);
      const admin = await actor('ADMIN', owner.organizationId),
        manager = await actor('MANAGER', owner.organizationId),
        agent = await actor('AGENT', owner.organizationId),
        otherAgent = await actor('AGENT', owner.organizationId),
        viewer = await actor('VIEWER', owner.organizationId);
      const teamResult = await call('POST', '/teams', owner, {
        name: 'Support',
        description: 'Primary',
      });
      assert.equal(teamResult.status, 201);
      const team = teamResult.body;
      const customerResult = await call('POST', '/customers', owner, {
        name: 'Acme Example',
        email: ' ACME@EXAMPLE.INVALID ',
        phone: '+100000',
        companyName: 'Searchable Company',
        notes: 'Private notes',
      });
      assert.equal(customerResult.status, 201);
      const customer = customerResult.body;
      const foreignTeam = (
        await call('POST', '/teams', foreign, { name: 'Foreign' })
      ).body;
      const foreignCustomer = (
        await call('POST', '/customers', foreign, { name: 'Foreign' })
      ).body;
      async function create(subject = 'Support issue', who = owner) {
        const result = await call<Ticket>('POST', '/tickets', who, {
          customerId: customer.id,
          subject,
          description: 'Ticket description',
          priority: 'HIGH',
          source: 'WEB',
        });
        assert.equal(result.status, 201);
        return result.body;
      }
      async function detail(id: string, who = owner) {
        const result = await call<Ticket>('GET', `/tickets/${id}`, who);
        assert.equal(result.status, 200);
        return result.body;
      }
      async function command(
        ticket: Ticket,
        action: string,
        who = owner,
        extra: Record<string, unknown> = {},
      ) {
        return call<Ticket>('POST', `/tickets/${ticket.id}/${action}`, who, {
          expectedVersion: ticket.version,
          ...extra,
        });
      }
      async function triage(ticket: Ticket) {
        const result = await command(ticket, 'triage');
        assert.equal(result.status, 200);
        return result.body;
      }
      async function assigned(
        target: { assignedTeamId?: string; assignedMemberId?: string } = {
          assignedMemberId: agent.memberId,
        },
      ) {
        let ticket = await triage(await create());
        const result = await command(ticket, 'assign', owner, target);
        assert.equal(result.status, 200);
        ticket = result.body;
        return ticket;
      }
      await t.test(
        'dashboard summary uses live tenant and agent ticket scope with zero empty counts',
        async () => {
          const empty = await call<Record<string, number>>(
            'GET',
            '/dashboard/summary',
            foreign,
          );
          assert.equal(empty.status, 200);
          for (const key of [
            'open',
            'urgent',
            'atRisk',
            'breached',
            'unassigned',
            'activeWork',
          ])
            assert.equal(empty.body[key], 0);
          const ticket = await assigned();
          const own = await call<Record<string, number>>(
            'GET',
            '/dashboard/summary',
            agent,
          );
          const other = await call<Record<string, number>>(
            'GET',
            '/dashboard/summary',
            otherAgent,
          );
          assert.equal(own.body.open, 1);
          assert.equal(other.body.open, 0);
          const policy = await db.slaPolicy.create({
            data: {
              organizationId: owner.organizationId,
              name: 'Summary fixture',
              priority: 'HIGH',
              firstResponseMinutes: 20,
              resolutionMinutes: 25,
              isActive: false,
            },
          });
          await db.ticket.update({
            where: { id: ticket.id },
            data: { priority: 'URGENT', status: 'IN_PROGRESS' },
          });
          await db.slaEvent.createMany({
            data: ['FIRST_RESPONSE', 'RESOLUTION'].map((type) => ({
              organizationId: owner.organizationId,
              ticketId: ticket.id,
              policyId: policy.id,
              type: type as 'FIRST_RESPONSE' | 'RESOLUTION',
              dueAt: new Date(Date.now() + 1200000),
            })),
          });
          const risk = await call<Record<string, number>>(
            'GET',
            '/dashboard/summary',
            owner,
          );
          assert.equal(risk.body.atRisk, 1);
          assert.equal(risk.body.urgent, 1);
          assert.equal(risk.body.activeWork, 1);
          assert.equal(risk.body.unassigned, 0);
          const listSla = await call<Page<{ sla: unknown[] }>>(
            'GET',
            '/tickets',
            owner,
          );
          assert.equal(listSla.body.data[0]!.sla.length, 2);
          await db.slaEvent.updateMany({
            where: { ticketId: ticket.id, type: 'FIRST_RESPONSE' },
            data: { dueAt: new Date(Date.now() - 60000) },
          });
          assert.equal(
            (
              await call<Record<string, number>>(
                'GET',
                '/dashboard/summary',
                owner,
              )
            ).body.breached,
            1,
          );
          await db.ticket.update({
            where: { id: ticket.id },
            data: { status: 'CLOSED' },
          });
          const terminal = await call<Record<string, number>>(
            'GET',
            '/dashboard/summary',
            owner,
          );
          assert.equal(terminal.body.atRisk, 0);
          assert.equal(terminal.body.breached, 0);
          assert.equal(terminal.body.open, 0);
          await db.$transaction(async (tx) => {
            await tx.outboxEvent.deleteMany({
              where: {
                ticketId: ticket.id,
                organizationId: owner.organizationId,
              },
            });
            await tx.slaEvent.deleteMany({ where: { ticketId: ticket.id } });
            await tx.slaPolicy.delete({ where: { id: policy.id } });
            await tx.ticketStatusHistory.deleteMany({
              where: { ticketId: ticket.id },
            });
            await tx.ticketAssignment.deleteMany({
              where: { ticketId: ticket.id },
            });
            await tx.auditLog.deleteMany({
              where: {
                entityId: ticket.id,
                organizationId: owner.organizationId,
              },
            });
            await tx.ticket.delete({ where: { id: ticket.id } });
            await tx.organizationTicketCounter.delete({
              where: { organizationId: owner.organizationId },
            });
          });
        },
      );
      await t.test(
        'member directory is bounded, safe, searchable and tenant/team scoped',
        async () => {
          const page = await call<Page<{ membershipId: string; name: string }>>(
            'GET',
            '/organization/members?limit=1',
            viewer,
          );
          assert.equal(page.status, 200);
          assert.equal(page.body.data.length, 1);
          assert.ok(page.body.pagination.total >= 6);
          assert.deepEqual(Object.keys(page.body.data[0]!).sort(), [
            'avatarUrl',
            'membershipId',
            'name',
            'userId',
          ]);
          const filtered = await call<Page<{ membershipId: string }>>(
            'GET',
            `/organization/members?teamId=${foreignTeam.id}`,
            owner,
          );
          assert.equal(filtered.body.pagination.total, 0);
          assert.equal(
            (await call('GET', '/organization/members?teamId=bad', owner))
              .status,
            400,
          );
          assert.equal(
            (await call('GET', '/organization/members?limit=101', owner))
              .status,
            400,
          );
          const search = await call<Page<{ membershipId: string }>>(
            'GET',
            '/organization/members?search=Fixture%20OWNER',
            owner,
          );
          assert.deepEqual(
            search.body.data.map((row) => row.membershipId),
            [owner.memberId],
          );
        },
      );
      await t.test(
        'teams list/detail/update and uniqueness are organization scoped',
        async () => {
          assert.equal(
            (
              await call('PATCH', `/teams/${team.id}`, manager, {
                name: 'Support Updated',
              })
            ).status,
            200,
          );
          assert.equal(
            (await call('GET', `/teams/${team.id}`, viewer)).status,
            200,
          );
          const list = await call<Page<Resource>>(
            'GET',
            '/teams?limit=1&page=1',
            agent,
          );
          assert.equal(list.status, 200);
          assert.equal(list.body.data.length, 1);
          assert.equal(list.body.pagination.total, 1);
          assert.equal(
            (await call('POST', '/teams', owner, { name: 'Support Updated' }))
              .status,
            409,
          );
          assert.equal(
            (await call('GET', `/teams/${foreignTeam.id}`, owner)).status,
            404,
          );
          assert.equal(
            (
              await call('PATCH', `/teams/${foreignTeam.id}`, owner, {
                name: 'Intrusion',
              })
            ).status,
            404,
          );
        },
      );
      await t.test(
        'team membership validates both tenants, prevents duplicates, and audits removal',
        async () => {
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
              await call('POST', `/teams/${team.id}/members`, owner, {
                membershipId: agent.memberId,
              })
            ).status,
            409,
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
              await call('POST', `/teams/${foreignTeam.id}/members`, owner, {
                membershipId: agent.memberId,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, owner, {
                membershipId: otherAgent.memberId,
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${otherAgent.memberId}`,
                owner,
              )
            ).status,
            204,
          );
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${foreign.memberId}`,
                owner,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        'customer CRUD, normalization, search and deterministic pagination',
        async () => {
          const get = await call<{ email: string; notes: string }>(
            'GET',
            `/customers/${customer.id}`,
            viewer,
          );
          assert.equal(get.status, 200);
          assert.equal(get.body.email, 'acme@example.invalid');
          assert.equal(
            (
              await call('PATCH', `/customers/${customer.id}`, manager, {
                notes: null,
                phone: '+222',
              })
            ).status,
            200,
          );
          for (const search of [
            'Acme',
            'example.invalid',
            '+222',
            'Searchable',
          ]) {
            const result = await call<Page<Resource>>(
              'GET',
              `/customers?search=${encodeURIComponent(search)}&limit=1&page=1`,
              viewer,
            );
            assert.equal(result.status, 200);
            assert.equal(result.body.pagination.total, 1);
            assert.equal(result.body.data[0]!.id, customer.id);
          }
          const list = await call<Page<Resource>>(
            'GET',
            '/customers?page=2&limit=1',
            owner,
          );
          assert.equal(list.body.data.length, 0);
          assert.equal(list.body.pagination.totalPages, 1);
          assert.equal(
            (await call('GET', `/customers/${foreignCustomer.id}`, owner))
              .status,
            404,
          );
          assert.equal(
            (
              await call('PATCH', `/customers/${foreignCustomer.id}`, owner, {
                name: 'Intrusion',
              })
            ).status,
            404,
          );
        },
      );
      await t.test(
        'explicit team/customer RBAC permits managers and denies agent/viewer mutations',
        async () => {
          for (const who of [agent, viewer]) {
            assert.equal(
              (await call('POST', '/teams', who, { name: 'Denied' })).status,
              403,
            );
            assert.equal(
              (
                await call('PATCH', `/teams/${team.id}`, who, {
                  name: 'Denied',
                })
              ).status,
              403,
            );
            assert.equal(
              (
                await call('POST', `/teams/${team.id}/members`, who, {
                  membershipId: who.memberId,
                })
              ).status,
              403,
            );
            assert.equal(
              (
                await call(
                  'DELETE',
                  `/teams/${team.id}/members/${agent.memberId}`,
                  who,
                )
              ).status,
              403,
            );
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
          for (const who of [owner, admin, manager])
            assert.equal(
              (
                await call('PATCH', `/customers/${customer.id}`, who, {
                  name: 'Acme Example',
                })
              ).status,
              200,
            );
        },
      );
      const initial = await create('Numbered Initial');
      await t.test(
        'ticket create owns initial status, number, timestamps, history and audit',
        async () => {
          assert.equal(initial.status, 'OPEN');
          assert.equal(initial.version, 0);
          assert.equal(initial.ticketNumber, 1);
          assert.equal(initial.reference, 'PD-000001');
          assert.equal(initial.resolvedAt, null);
          assert.equal(initial.closedAt, null);
          const ticket = await detail(initial.id);
          assert.equal(ticket.statusHistory.length, 1);
          assert.equal(ticket.statusHistory[0]!.fromStatus, null);
          assert.equal(ticket.statusHistory[0]!.toStatus, 'OPEN');
          assert.equal(
            await db.auditLog.count({
              where: {
                organizationId: owner.organizationId,
                entityId: initial.id,
                action: 'TICKET_CREATED',
              },
            }),
            1,
          );
        },
      );
      await t.test(
        'foreign customers and mass-assigned ticket fields are rejected',
        async () => {
          assert.equal(
            (
              await call('POST', '/tickets', owner, {
                customerId: foreignCustomer.id,
                subject: 'Foreign',
                description: 'Bad',
              })
            ).status,
            404,
          );
          for (const field of [
            'organizationId',
            'status',
            'ticketNumber',
            'assignedMemberId',
            'assignedTeamId',
            'resolvedAt',
            'closedAt',
            'version',
          ])
            assert.equal(
              (
                await call('POST', '/tickets', owner, {
                  customerId: customer.id,
                  subject: 'Bad',
                  description: 'Bad',
                  [field]: 'forbidden',
                })
              ).status,
              400,
            );
          assert.equal(
            (
              await call('POST', '/tickets', viewer, {
                customerId: customer.id,
                subject: 'Denied',
                description: 'Denied',
              })
            ).status,
            403,
          );
          const created = await create('Agent-created', agent);
          assert.equal(
            (await call('GET', `/tickets/${created.id}`, agent)).status,
            404,
          );
        },
      );
      await t.test(
        'concurrent ticket numbers are unique and organization local',
        async () => {
          const tickets = await Promise.all(
            Array.from({ length: 16 }, (_, i) =>
              create(`Concurrent number ${i}`),
            ),
          );
          assert.equal(
            new Set(tickets.map((ticket) => ticket.ticketNumber)).size,
            16,
          );
          const numbers = tickets
            .map((ticket) => ticket.ticketNumber)
            .sort((a, b) => a - b);
          for (let i = 1; i < numbers.length; i++)
            assert.equal(numbers[i], numbers[i - 1]! + 1);
          const foreignTicket = await call<Ticket>(
            'POST',
            '/tickets',
            foreign,
            {
              customerId: foreignCustomer.id,
              subject: 'Foreign',
              description: 'First in organization B',
            },
          );
          assert.equal(foreignTicket.status, 201);
          assert.equal(foreignTicket.body.ticketNumber, 1);
        },
      );
      await t.test(
        'safe filters, search, sort allowlists and bounded pages preserve tenant scope',
        async () => {
          for (const query of [
            'priority=HIGH',
            'status=OPEN',
            `customerId=${customer.id}`,
            `search=PD-000001`,
            `search=Numbered`,
          ]) {
            const result = await call<Page<Ticket>>(
              'GET',
              `/tickets?${query}&sort=ticketNumber:asc&limit=2`,
              viewer,
            );
            assert.equal(result.status, 200);
            assert.ok(result.body.pagination.total > 0);
            assert.ok(result.body.data.length <= 2);
          }
          for (const filter of [
            `customerId=${foreignCustomer.id}`,
            `assignedTeamId=${foreignTeam.id}`,
            `assignedMemberId=${foreign.memberId}`,
          ]) {
            const result = await call<Page<Ticket>>(
              'GET',
              `/tickets?${filter}`,
              owner,
            );
            assert.equal(result.body.pagination.total, 0);
          }
          for (const query of [
            'page=0',
            'page=-1',
            'page=1.5',
            'page=10001',
            'limit=101',
            'limit=0',
            'page=1&page=2',
            'sort=passwordHash:asc',
            'sort[passwordHash]=asc',
            'status=INVALID',
            'organizationId=x',
            'assignedMemberId=invalid',
          ])
            assert.equal(
              (await call('GET', `/tickets?${query}`, owner)).status,
              400,
            );
          const first = await call<Page<Ticket>>(
              'GET',
              '/tickets?sort=ticketNumber:asc&limit=2',
              owner,
            ),
            second = await call<Page<Ticket>>(
              'GET',
              '/tickets?sort=ticketNumber:asc&limit=2&page=2',
              owner,
            );
          assert.equal(first.body.data[0]!.id, initial.id);
          assert.ok(
            first.body.data.every(
              (row) => !second.body.data.some((other) => other.id === row.id),
            ),
          );
          assert.equal(
            (await call('GET', '/customers?limit=101', owner)).status,
            400,
          );
          assert.equal(
            (await call('PATCH', `/customers/${customer.id}`, owner, {}))
              .status,
            400,
          );
        },
      );
      await t.test('ticket detail and commands hide foreign IDs', async () => {
        assert.equal(
          (await call('GET', `/tickets/${initial.id}`, foreign)).status,
          404,
        );
        assert.equal(
          (
            await call('POST', `/tickets/${initial.id}/triage`, foreign, {
              expectedVersion: 0,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await call('POST', `/tickets/${initial.id}/comments`, foreign, {
              body: 'Foreign',
              visibility: 'PUBLIC',
            })
          ).status,
          404,
        );
        assert.equal(
          (await call('GET', '/tickets/not-a-uuid', owner)).status,
          400,
        );
        assert.equal(
          (
            await call('PATCH', `/tickets/${initial.id}`, owner, {
              status: 'CLOSED',
            })
          ).status,
          404,
        );
      });
      await t.test(
        'assignment validates tenant, member/team combination, and records history',
        async () => {
          let ticket = await triage(await create('Assignment validation'));
          for (const target of [
            { assignedMemberId: foreign.memberId },
            { assignedTeamId: foreignTeam.id },
          ])
            assert.equal(
              (await command(ticket, 'assign', owner, target)).status,
              404,
            );
          assert.equal(
            (await command(ticket, 'assign', owner, {})).status,
            400,
          );
          assert.equal(
            (
              await command(ticket, 'assign', owner, {
                assignedTeamId: team.id,
                assignedMemberId: otherAgent.memberId,
              })
            ).status,
            409,
          );
          let result = await command(ticket, 'assign', owner, {
            assignedTeamId: team.id,
            assignedMemberId: agent.memberId,
          });
          assert.equal(result.status, 200);
          ticket = result.body;
          assert.equal(ticket.status, 'ASSIGNED');
          let details = await detail(ticket.id);
          assert.equal(details.assignmentHistory.length, 1);
          assert.equal(details.statusHistory.at(-1)!.toStatus, 'ASSIGNED');
          assert.equal(
            (
              await command(ticket, 'assign', owner, {
                assignedTeamId: team.id,
                assignedMemberId: agent.memberId,
              })
            ).status,
            409,
          );
          result = await command(ticket, 'assign', owner, {
            assignedMemberId: otherAgent.memberId,
          });
          assert.equal(result.status, 200);
          ticket = result.body;
          assert.equal(ticket.assignedTeam, null);
          details = await detail(ticket.id);
          assert.equal(details.assignmentHistory.length, 2);
          assert.equal(details.statusHistory.length, 3);
          assert.equal(
            await db.auditLog.count({
              where: {
                entityId: ticket.id,
                organizationId: owner.organizationId,
                action: 'TICKET_REASSIGNED',
              },
            }),
            1,
          );
        },
      );
      const teamTicket = await assigned({ assignedTeamId: team.id });
      const directTicket = await assigned();
      await t.test(
        'agents see direct or current-team assignments only, with live removal',
        async () => {
          assert.equal(
            (await call('GET', `/tickets/${teamTicket.id}`, agent)).status,
            200,
          );
          assert.equal(
            (await call('GET', `/tickets/${directTicket.id}`, agent)).status,
            200,
          );
          assert.equal(
            (await call('GET', `/tickets/${teamTicket.id}`, otherAgent)).status,
            404,
          );
          assert.equal(
            (await call('GET', `/tickets/${initial.id}`, agent)).status,
            404,
          );
          const list = await call<Page<Ticket>>(
            'GET',
            `/tickets?limit=100`,
            agent,
          );
          assert.equal(list.status, 200);
          assert.ok(
            list.body.data.every(
              (ticket) =>
                ticket.assignedMember?.membershipId === agent.memberId ||
                ticket.assignedTeam?.id === team.id,
            ),
          );
          assert.equal(
            (
              await call(
                'DELETE',
                `/teams/${team.id}/members/${agent.memberId}`,
                owner,
              )
            ).status,
            204,
          );
          assert.equal(
            (await call('GET', `/tickets/${teamTicket.id}`, agent)).status,
            404,
          );
          assert.equal((await command(teamTicket, 'start', agent)).status, 404);
          assert.equal(
            (await call('GET', `/tickets/${directTicket.id}`, agent)).status,
            200,
          );
          assert.equal(
            (
              await call('POST', `/teams/${team.id}/members`, owner, {
                membershipId: agent.memberId,
              })
            ).status,
            201,
          );
        },
      );
      await t.test(
        'full working lifecycle is explicit and records timestamps and all transitions',
        async () => {
          let ticket = await assigned({ assignedTeamId: team.id });
          for (const action of [
            'start',
            'wait-for-customer',
            'resume',
            'resolve',
          ]) {
            const result = await command(ticket, action, agent);
            assert.equal(result.status, 200);
            ticket = result.body;
          }
          assert.equal(ticket.status, 'RESOLVED');
          assert.ok(ticket.resolvedAt);
          assert.equal(ticket.closedAt, null);
          assert.equal((await command(ticket, 'close', agent)).status, 403);
          const closed = await command(ticket, 'close', manager);
          assert.equal(closed.status, 200);
          ticket = closed.body;
          assert.ok(ticket.closedAt);
          assert.ok(ticket.resolvedAt);
          const history = (await detail(ticket.id)).statusHistory;
          assert.deepEqual(
            history.map((row) => row.toStatus),
            [
              'OPEN',
              'TRIAGED',
              'ASSIGNED',
              'IN_PROGRESS',
              'WAITING_CUSTOMER',
              'IN_PROGRESS',
              'RESOLVED',
              'CLOSED',
            ],
          );
          for (let i = 1; i < history.length; i++)
            assert.equal(history[i]!.fromStatus, history[i - 1]!.toStatus);
          assert.equal((await command(ticket, 'start', owner)).status, 409);
          assert.equal(
            (await command(ticket, 'cancel', owner, { reason: 'No reopen' }))
              .status,
            409,
          );
        },
      );
      await t.test(
        'invalid transitions, forbidden roles, and in-progress reassignment are rejected',
        async () => {
          const open = await create();
          for (const action of [
            'start',
            'resolve',
            'close',
            'resume',
            'wait-for-customer',
            'assign',
          ])
            assert.equal(
              (
                await command(
                  open,
                  action,
                  owner,
                  action === 'assign'
                    ? { assignedMemberId: agent.memberId }
                    : {},
                )
              ).status,
              409,
            );
          const triaged = await triage(open);
          assert.equal((await command(triaged, 'start')).status, 409);
          let ticket = await assigned();
          assert.equal((await command(ticket, 'resolve')).status, 409);
          assert.equal(
            (await command(ticket, 'start', otherAgent)).status,
            404,
          );
          assert.equal((await command(ticket, 'start', viewer)).status, 403);
          assert.equal((await command(ticket, 'triage', agent)).status, 403);
          assert.equal(
            (
              await command(ticket, 'assign', agent, {
                assignedMemberId: agent.memberId,
              })
            ).status,
            403,
          );
          const started = await command(ticket, 'start', agent);
          assert.equal(started.status, 200);
          ticket = started.body;
          assert.equal(
            (
              await command(ticket, 'assign', manager, {
                assignedMemberId: otherAgent.memberId,
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        'cancellation requires reason and is limited to pre-work states and manager roles',
        async () => {
          for (const state of ['OPEN', 'TRIAGED', 'ASSIGNED']) {
            let ticket =
              state === 'ASSIGNED' ? await assigned() : await create();
            if (state === 'TRIAGED') ticket = await triage(ticket);
            assert.equal(
              (await command(ticket, 'cancel', owner, { reason: ' ' })).status,
              400,
            );
            assert.equal(
              (
                await command(ticket, 'cancel', agent, {
                  reason: 'Not authorized',
                })
              ).status,
              403,
            );
            const result = await command(ticket, 'cancel', manager, {
              reason: 'Duplicate request',
            });
            assert.equal(result.status, 200);
            assert.equal(result.body.status, 'CANCELLED');
            assert.equal(
              (await detail(ticket.id)).statusHistory.at(-1)!.reason,
              'Duplicate request',
            );
            assert.equal((await command(result.body, 'triage')).status, 409);
          }
        },
      );
      await t.test(
        'comments support staff INTERNAL/PUBLIC, enforce access, and keep bodies out of audit metadata',
        async () => {
          for (const visibility of ['INTERNAL', 'PUBLIC'])
            assert.equal(
              (
                await call(
                  'POST',
                  `/tickets/${directTicket.id}/comments`,
                  agent,
                  { body: `Sensitive ${visibility} comment`, visibility },
                )
              ).status,
              201,
            );
          assert.equal(
            (
              await call(
                'POST',
                `/tickets/${directTicket.id}/comments`,
                viewer,
                { body: 'Denied' },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/tickets/${directTicket.id}/comments`,
                otherAgent,
                { body: 'Denied' },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/tickets/${directTicket.id}/comments`,
                owner,
                { body: ' ' },
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/tickets/${directTicket.id}/comments`,
                owner,
                { body: 'x'.repeat(10001) },
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/tickets/${directTicket.id}/comments`,
                owner,
                { body: 'Bad', authorMemberId: foreign.memberId },
              )
            ).status,
            400,
          );
          const ticket = await detail(directTicket.id, viewer);
          assert.deepEqual(
            ticket.comments.map((comment) => comment.visibility).sort(),
            ['INTERNAL', 'PUBLIC'],
          );
          const logs = await db.auditLog.findMany({
            where: {
              organizationId: owner.organizationId,
              entityId: directTicket.id,
              action: 'TICKET_COMMENT_ADDED',
            },
          });
          assert.equal(logs.length, 2);
          assert.ok(
            !JSON.stringify(logs.map((log) => log.metadata)).includes(
              'Sensitive',
            ),
          );
        },
      );
      await t.test(
        'competing assignments with the same version yield one winner and one conflict',
        async () => {
          const ticket = await triage(await create());
          const results = await Promise.all([
            command(ticket, 'assign', owner, {
              assignedMemberId: agent.memberId,
            }),
            command(ticket, 'assign', manager, {
              assignedMemberId: otherAgent.memberId,
            }),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          const current = await detail(ticket.id);
          assert.equal(current.assignmentHistory.length, 1);
          assert.equal(current.version, ticket.version + 1);
        },
      );
      await t.test(
        'start versus cancellation and duplicate close requests cannot both commit',
        async () => {
          let ticket = await assigned();
          const results = await Promise.all([
            command(ticket, 'start', agent),
            command(ticket, 'cancel', manager, { reason: 'Concurrent cancel' }),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          const current = await detail(ticket.id);
          assert.equal(current.statusHistory.length, 4);
          ticket = await assigned();
          ticket = (await command(ticket, 'start', agent)).body;
          ticket = (await command(ticket, 'resolve', agent)).body;
          const closes = await Promise.all([
            command(ticket, 'close', owner),
            command(ticket, 'close', manager),
          ]);
          assert.deepEqual(closes.map((r) => r.status).sort(), [200, 409]);
          assert.equal(
            (await detail(ticket.id)).statusHistory.filter(
              (row) => row.toStatus === 'CLOSED',
            ).length,
            1,
          );
        },
      );
      await t.test(
        'failed audit rolls back ticket creation/counter, transition, assignment and comment',
        async () => {
          const open = await create('Rollback open');
          const triaged = await triage(await create('Rollback assigned'));
          const beforeCount = await db.ticket.count({
            where: { organizationId: owner.organizationId },
          });
          const beforeNumber =
            await db.organizationTicketCounter.findUniqueOrThrow({
              where: { organizationId: owner.organizationId },
            });
          const functionName = `test_audit_${randomUUID().replaceAll('-', '')}`;
          const triggerName = `trigger_${functionName}`;
          // Identifiers and UUID below are generated test fixtures, never request input.
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorMemberId" = '${owner.memberId}'::uuid THEN RAISE EXCEPTION 'isolated test audit failure'; END IF; RETURN NEW; END $$`,
          );
          try {
            await db.$executeRawUnsafe(
              `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
            );
            try {
              assert.equal(
                (
                  await call('POST', '/tickets', owner, {
                    customerId: customer.id,
                    subject: 'Must roll back',
                    description: 'No partial writes',
                  })
                ).status,
                500,
              );
              assert.equal((await command(open, 'triage')).status, 500);
              assert.equal(
                (
                  await command(triaged, 'assign', owner, {
                    assignedMemberId: agent.memberId,
                  })
                ).status,
                500,
              );
              assert.equal(
                (
                  await call('POST', `/tickets/${open.id}/comments`, owner, {
                    body: 'Must roll back',
                  })
                ).status,
                500,
              );
            } finally {
              await db.$executeRawUnsafe(
                `DROP TRIGGER "${triggerName}" ON "AuditLog"`,
              );
            }
          } finally {
            await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
          }
          assert.equal(
            await db.ticket.count({
              where: { organizationId: owner.organizationId },
            }),
            beforeCount,
          );
          assert.equal(
            (
              await db.organizationTicketCounter.findUniqueOrThrow({
                where: { organizationId: owner.organizationId },
              })
            ).lastNumber,
            beforeNumber.lastNumber,
          );
          const unchanged = await detail(open.id);
          assert.equal(unchanged.version, 0);
          assert.equal(unchanged.statusHistory.length, 1);
          assert.equal(unchanged.comments.length, 0);
          assert.equal((await detail(triaged.id)).assignmentHistory.length, 0);
        },
      );
      await t.test(
        'all required meaningful mutation audit actions are emitted with scoped actors',
        async () => {
          const logs = await db.auditLog.findMany({
            where: { organizationId: owner.organizationId },
          });
          const actions = new Set(logs.map((log) => log.action));
          for (const action of [
            'TEAM_CREATED',
            'TEAM_UPDATED',
            'TEAM_MEMBER_ADDED',
            'TEAM_MEMBER_REMOVED',
            'CUSTOMER_CREATED',
            'CUSTOMER_UPDATED',
            'TICKET_CREATED',
            'TICKET_TRIAGED',
            'TICKET_ASSIGNED',
            'TICKET_REASSIGNED',
            'TICKET_STARTED',
            'TICKET_WAITING_CUSTOMER',
            'TICKET_RESUMED',
            'TICKET_RESOLVED',
            'TICKET_CLOSED',
            'TICKET_CANCELLED',
            'TICKET_COMMENT_ADDED',
          ])
            assert.ok(actions.has(action), action);
          assert.ok(logs.every((log) => log.actorMemberId));
        },
      );
    } finally {
      try {
        await db.$transaction(async (tx) => {
          const where = { organizationId: { in: orgIds } };
          await tx.outboxEvent.deleteMany({ where });
          await tx.slaEvent.deleteMany({ where });
          await tx.ticketComment.deleteMany({ where });
          await tx.ticketStatusHistory.deleteMany({ where });
          await tx.ticketAssignment.deleteMany({ where });
          await tx.auditLog.deleteMany({ where });
          await tx.ticket.deleteMany({ where });
          await tx.slaPolicy.deleteMany({ where });
          await tx.organizationTicketCounter.deleteMany({ where });
          await tx.customer.deleteMany({ where });
          await tx.teamMember.deleteMany({ where });
          await tx.team.deleteMany({ where });
          await tx.organizationMember.deleteMany({ where });
          await tx.refreshToken.deleteMany({
            where: { userId: { in: userIds } },
          });
          await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        });
      } finally {
        await app.close();
      }
    }
  },
);
