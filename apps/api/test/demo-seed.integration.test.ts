import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import { PasswordService } from '../src/modules/auth/password.service';
import { SlaDeadlineService } from '../src/modules/sla/sla-deadline.service';
import { Clock } from '../src/common/clock.module';
import { seedDemo } from '../src/demo/seed-demo';
import {
  DEMO_ORGANIZATION_ID as organizationId,
  DEMO_PASSWORD,
  DEMO_USERS,
  DEMO_TICKETS,
  DEMO_POLICIES,
  DEMO_CUSTOMERS,
  demoId,
} from '../src/demo/manifest';
const url = process.env.TEST_DATABASE_URL;
test(
  'local demo seed creates coherent fixtures, preserves edits and is transactionally idempotent',
  { skip: !url && 'Set TEST_DATABASE_URL to an isolated migrated database' },
  async (t) => {
    const db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.onModuleInit();
    const env = { NODE_ENV: 'test', DATABASE_URL: url };
    const userIds = DEMO_USERS.map((user) => demoId(`user:${user.role}`));
    let seeded = false;
    const existing = await db.user.count({
      where: {
        OR: [
          { id: { in: userIds } },
          { email: { in: DEMO_USERS.map((user) => user.email) } },
        ],
      },
    });
    if (
      existing ||
      (await db.organization.count({
        where: { OR: [{ id: organizationId }, { slug: 'pulsedesk-demo' }] },
      }))
    ) {
      await db.onApplicationShutdown();
      t.skip(
        'The dedicated test database already contains demo identities; existing data will not be reset.',
      );
      return;
    }
    const now = new Date(Math.floor(Date.now() / 60000) * 60000);
    async function snapshot() {
      const where = { organizationId };
      return {
        organization: await db.organization.findUnique({
          where: { id: organizationId },
        }),
        users: await db.user.findMany({
          where: { id: { in: userIds } },
          orderBy: { id: 'asc' },
        }),
        members: await db.organizationMember.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        teams: await db.team.findMany({ where, orderBy: { id: 'asc' } }),
        teamMembers: await db.teamMember.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        customers: await db.customer.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        policies: await db.slaPolicy.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        tickets: await db.ticket.findMany({ where, orderBy: { id: 'asc' } }),
        histories: await db.ticketStatusHistory.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        assignments: await db.ticketAssignment.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        comments: await db.ticketComment.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        sla: await db.slaEvent.findMany({ where, orderBy: { id: 'asc' } }),
        notifications: await db.notification.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        outbox: await db.outboxEvent.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        audit: await db.auditLog.findMany({ where, orderBy: { id: 'asc' } }),
        counter: await db.organizationTicketCounter.findUnique({
          where: { organizationId },
        }),
      };
    }
    try {
      await t.test(
        'conflicting pre-existing email is not adopted and all seed writes roll back',
        async () => {
          const id = randomUUID();
          await db.user.create({
            data: {
              id,
              email: DEMO_USERS[0].email,
              name: 'Unrelated test user',
              passwordHash: 'not-a-demo-hash',
            },
          });
          try {
            await assert.rejects(seedDemo(db, env, now), /already in use/);
            assert.equal(
              await db.organization.count({ where: { id: organizationId } }),
              0,
            );
            assert.equal(
              (await db.user.findUniqueOrThrow({ where: { id } })).passwordHash,
              'not-a-demo-hash',
            );
          } finally {
            await db.user.delete({ where: { id } });
          }
        },
      );
      await t.test(
        'a failure after earlier fixture writes rolls the entire seed back',
        async () => {
          const failing = db.$extends({
            query: {
              ticket: {
                create({ args, query }) {
                  if (args.data.id === demoId('ticket:3'))
                    throw new Error('forced fixture failure');
                  return query(args);
                },
              },
            },
          });
          // Query extensions change generated transaction overloads, not the underlying client semantics.
          await assert.rejects(
            seedDemo(
              failing as unknown as Pick<PrismaService, '$transaction'>,
              env,
              now,
            ),
            /forced fixture failure/,
          );
          assert.equal(
            await db.organization.count({ where: { id: organizationId } }),
            0,
          );
          assert.equal(
            await db.user.count({ where: { id: { in: userIds } } }),
            0,
          );
          assert.equal(
            await db.outboxEvent.count({ where: { organizationId } }),
            0,
          );
        },
      );
      await t.test(
        'first run succeeds and second/concurrent runs leave every row unchanged',
        async () => {
          const first = await seedDemo(db, env, now);
          seeded = true;
          assert.equal(first.createdTickets, 6);
          const before = await snapshot();
          assert.equal(
            (await seedDemo(db, env, new Date(now.getTime() + 3600000)))
              .createdTickets,
            0,
          );
          assert.deepEqual(await snapshot(), before);
          const results = await Promise.all([
            seedDemo(db, env, now),
            seedDemo(db, env, now),
          ]);
          assert.ok(results.every((result) => result.createdTickets === 0));
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        'all four users have production Argon2id hashes and matching tenant roles',
        async () => {
          const passwords = new PasswordService();
          for (const user of DEMO_USERS) {
            const row = await db.user.findUniqueOrThrow({
              where: { email: user.email },
            });
            assert.match(
              row.passwordHash,
              /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
            );
            assert.notEqual(row.passwordHash, DEMO_PASSWORD);
            assert.ok(await passwords.matches(DEMO_PASSWORD, row.passwordHash));
            const member = await db.organizationMember.findUniqueOrThrow({
              where: {
                organizationId_userId: { organizationId, userId: row.id },
              },
            });
            assert.equal(member.role, user.role);
          }
        },
      );
      await t.test(
        'two teams, three exact memberships and three customers are scoped correctly',
        async () => {
          assert.equal(await db.team.count({ where: { organizationId } }), 2);
          const members = await db.teamMember.findMany({
            where: { organizationId },
          });
          assert.equal(members.length, 3);
          assert.deepEqual(
            members.map((row) => [row.teamId, row.memberId]).sort(),
            [
              [demoId('team:Customer Support'), demoId('membership:AGENT')],
              [demoId('team:Customer Support'), demoId('membership:MANAGER')],
              [demoId('team:Technical Support'), demoId('membership:MANAGER')],
            ].sort(),
          );
          const customers = await db.customer.findMany({
            where: { organizationId },
          });
          assert.equal(customers.length, 3);
          for (const customer of DEMO_CUSTOMERS)
            assert.ok(
              customers.some(
                (row) =>
                  row.email === customer.email &&
                  row.name === customer.name &&
                  row.phone === customer.phone,
              ),
            );
        },
      );
      await t.test(
        'ticket versions, timestamps, same-tenant assignments and histories match every workflow state',
        async () => {
          const expected = [
            'OPEN',
            'TRIAGED',
            'ASSIGNED',
            'IN_PROGRESS',
            'WAITING_CUSTOMER',
            'RESOLVED',
          ];
          for (const [index, plan] of DEMO_TICKETS.entries()) {
            const ticket = await db.ticket.findUniqueOrThrow({
              where: { id: demoId(`ticket:${index + 1}`) },
              include: {
                statusHistory: { orderBy: { createdAt: 'asc' } },
                assignments: true,
                assignedMember: true,
                assignedTeam: true,
                comments: true,
              },
            });
            assert.equal(ticket.status, expected[index]);
            assert.equal(ticket.version, plan.steps.length);
            assert.equal(ticket.statusHistory.length, ticket.version + 1);
            assert.equal(ticket.statusHistory[0]!.fromStatus, null);
            assert.equal(ticket.statusHistory.at(-1)!.toStatus, ticket.status);
            assert.equal(
              ticket.statusHistory.at(-1)!.createdAt.getTime(),
              ticket.updatedAt.getTime(),
            );
            for (let step = 1; step < ticket.statusHistory.length; step++)
              assert.equal(
                ticket.statusHistory[step]!.fromStatus,
                ticket.statusHistory[step - 1]!.toStatus,
              );
            if (index >= 2) {
              assert.equal(ticket.assignments.length, 1);
              assert.equal(
                ticket.assignedMember!.organizationId,
                organizationId,
              );
              assert.equal(ticket.assignedTeam!.organizationId, organizationId);
              assert.ok(
                await db.teamMember.findUnique({
                  where: {
                    organizationId_teamId_memberId: {
                      organizationId,
                      teamId: ticket.assignedTeamId!,
                      memberId: ticket.assignedMemberId!,
                    },
                  },
                }),
              );
            } else {
              assert.equal(ticket.assignedMemberId, null);
              assert.equal(ticket.assignedTeamId, null);
              assert.equal(ticket.assignments.length, 0);
            }
            assert.equal(!!ticket.resolvedAt, index === 5);
            assert.equal(ticket.closedAt, null);
            if (ticket.resolvedAt)
              assert.equal(
                ticket.resolvedAt.getTime(),
                ticket.updatedAt.getTime(),
              );
          }
          assert.equal(
            (
              await db.organizationTicketCounter.findUniqueOrThrow({
                where: { organizationId },
              })
            ).lastNumber,
            6,
          );
          assert.equal(
            await db.ticketComment.count({ where: { organizationId } }),
            4,
          );
        },
      );
      await t.test(
        'SLA deadlines use policy durations with healthy, near-risk, breached and completed coverage',
        async () => {
          const policies = await db.slaPolicy.findMany({
            where: { organizationId },
          });
          assert.equal(policies.length, 4);
          for (const plan of DEMO_POLICIES)
            assert.ok(
              policies.some(
                (row) =>
                  row.isActive &&
                  row.priority === plan.priority &&
                  row.firstResponseMinutes === plan.firstResponseMinutes &&
                  row.resolutionMinutes === plan.resolutionMinutes,
              ),
            );
          const events = await db.slaEvent.findMany({
            where: { organizationId },
            include: { ticket: true, policy: true },
          });
          assert.equal(events.length, 12);
          for (const event of events) {
            assert.equal(
              event.dueAt.getTime() - event.ticket.createdAt.getTime(),
              60000 *
                (event.type === 'FIRST_RESPONSE'
                  ? event.policy.firstResponseMinutes
                  : event.policy.resolutionMinutes),
            );
            if (event.completedAt)
              assert.ok(
                event.completedAt >= event.createdAt &&
                  event.completedAt <= event.dueAt,
              );
            if (event.breachedAt)
              assert.ok(
                event.breachedAt > event.dueAt && event.breachedAt <= now,
              );
          }
          assert.ok(
            events.some(
              (row) =>
                !row.completedAt &&
                !row.breachedAt &&
                row.dueAt.getTime() > now.getTime() + 1800000,
            ),
          );
          assert.ok(
            events.some(
              (row) =>
                !row.completedAt &&
                !row.breachedAt &&
                row.dueAt > now &&
                row.dueAt.getTime() <= now.getTime() + 1800000,
            ),
          );
          assert.equal(events.filter((row) => row.breachedAt).length, 1);
          assert.equal(events.filter((row) => row.completedAt).length, 4);
          const before = await db.notification.count({
            where: { organizationId },
          });
          const service = new SlaDeadlineService(db, {
            now: () => now,
          } as Clock);
          for (const event of events.filter(
            (row) => row.breachedAt || row.completedAt,
          ))
            assert.deepEqual(await service.process(event.id, event.type), {
              state: 'noop',
            });
          assert.equal(
            await db.notification.count({ where: { organizationId } }),
            before,
          );
          assert.equal(
            await db.outboxEvent.count({
              where: { organizationId, type: 'SLA_EVENT_SCHEDULED' },
            }),
            12,
          );
        },
      );
      await t.test(
        'notification read/unread mixture is recipient scoped and emitted through the outbox',
        async () => {
          const notifications = await db.notification.findMany({
            where: { organizationId },
          });
          assert.equal(notifications.length, 4);
          assert.equal(notifications.filter((row) => row.readAt).length, 1);
          assert.equal(
            notifications.filter(
              (row) => row.recipientMemberId === demoId('membership:AGENT'),
            ).length,
            1,
          );
          assert.equal(
            notifications.filter(
              (row) => row.recipientMemberId === demoId('membership:MANAGER'),
            ).length,
            2,
          );
          assert.equal(
            await db.outboxEvent.count({
              where: { organizationId, type: 'NOTIFICATION_CREATED' },
            }),
            4,
          );
        },
      );
      await t.test(
        'real HTTP manager/agent login obeys RBAC and rerunning does not reset workflow or read state',
        async () => {
          const module = await Test.createTestingModule({
            imports: [AppModule],
          })
            .overrideProvider(PrismaService)
            .useValue(db)
            .overrideProvider(RealtimeDispatchRuntime)
            .useValue({})
            .compile();
          const app = module.createNestApplication({ logger: false });
          try {
            await app.listen(0, '127.0.0.1');
            const base = await app.getUrl();
            const login = async (email: string) => {
              const response = await fetch(base + '/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, password: DEMO_PASSWORD }),
              });
              assert.equal(response.status, 200);
              const data = (await response.json()) as {
                accessToken: string;
                user: Record<string, unknown>;
              };
              assert.equal('passwordHash' in data.user, false);
              return data.accessToken;
            };
            const manager = await login('manager@pulsedesk.local'),
              agent = await login('agent@pulsedesk.local'),
              viewer = await login('viewer@pulsedesk.local');
            const headers = (token: string) => ({
              authorization: `Bearer ${token}`,
              'x-organization-id': organizationId,
              'content-type': 'application/json',
            });
            const managerList = await fetch(base + '/tickets', {
              headers: headers(manager),
            });
            assert.equal(
              ((await managerList.json()) as { pagination: { total: number } })
                .pagination.total,
              6,
            );
            const agentList = await fetch(base + '/tickets', {
              headers: headers(agent),
            });
            assert.equal(
              ((await agentList.json()) as { pagination: { total: number } })
                .pagination.total,
              3,
            );
            assert.equal(
              (
                await fetch(base + `/tickets/${demoId('ticket:4')}`, {
                  headers: headers(agent),
                })
              ).status,
              404,
            );
            assert.equal(
              (
                await fetch(base + `/tickets/${demoId('ticket:1')}/triage`, {
                  method: 'POST',
                  headers: headers(viewer),
                  body: JSON.stringify({ expectedVersion: 0 }),
                })
              ).status,
              403,
            );
            assert.equal(
              (
                await fetch(base + `/tickets/${demoId('ticket:1')}/triage`, {
                  method: 'POST',
                  headers: headers(manager),
                  body: JSON.stringify({ expectedVersion: 0 }),
                })
              ).status,
              200,
            );
            assert.equal(
              (
                await fetch(base + `/tickets/${demoId('ticket:3')}/start`, {
                  method: 'POST',
                  headers: headers(agent),
                  body: JSON.stringify({ expectedVersion: 2 }),
                })
              ).status,
              200,
            );
            await db.notification.update({
              where: { id: demoId('notification:assignment') },
              data: { readAt: now },
            });
            await seedDemo(db, env, now);
            assert.equal(
              (
                await db.ticket.findUniqueOrThrow({
                  where: { id: demoId('ticket:1') },
                })
              ).status,
              'TRIAGED',
            );
            assert.equal(
              (
                await db.ticket.findUniqueOrThrow({
                  where: { id: demoId('ticket:3') },
                })
              ).status,
              'IN_PROGRESS',
            );
            assert.ok(
              (
                await db.notification.findUniqueOrThrow({
                  where: { id: demoId('notification:assignment') },
                })
              ).readAt,
            );
          } finally {
            await app.close();
          }
        },
      );
    } finally {
      if (seeded)
        await db.$transaction(async (tx) => {
          const where = { organizationId };
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
          await tx.refreshToken.deleteMany({
            where: { userId: { in: userIds } },
          });
          await tx.organization.delete({ where: { id: organizationId } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        });
      await db.onApplicationShutdown();
    }
  },
);
