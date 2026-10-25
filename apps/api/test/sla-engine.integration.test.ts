import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import { QueueRecovery } from '../src/worker/queue-recovery.service';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SlaQueue, jobId } from '../src/infrastructure/queue/sla-queue.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { OutboxDispatcher } from '../src/infrastructure/queue/outbox-dispatcher.service';
import { Clock, ClockModule } from '../src/common/clock.module';
import { SlaDeadlineService } from '../src/modules/sla/sla-deadline.service';
import { WorkerRuntime } from '../src/worker/worker-runtime.service';
import type {
  OrganizationRole,
  SlaEvent,
} from '../src/generated/prisma/client';
interface Actor {
  id: string;
  userId: string;
  token: string;
  organizationId: string;
}
interface Ticket {
  id: string;
  version: number;
  createdAt: string;
  sla: Array<{
    id: string;
    type: string;
    status: string;
    completedAt: string | null;
    breachedAt: string | null;
  }>;
}
interface Policy {
  id: string;
  name: string;
  firstResponseMinutes: number;
}
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
test(
  'recoverable SLA engine over PostgreSQL and real Redis/BullMQ',
  {
    skip:
      (!databaseUrl || !redisUrl) &&
      'Set dedicated TEST_DATABASE_URL and TEST_REDIS_URL',
  },
  async (t) => {
    const db = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await t.test(
      'pooled connections force UTC and preserve timestamptz instants',
      async () => {
        const zones = await db.$queryRaw<
          Array<{ TimeZone: string }>
        >`SHOW TIME ZONE`;
        assert.equal(zones[0]!.TimeZone, 'UTC');
        const rows = await db.$queryRaw<
          Array<{ instant: Date }>
        >`SELECT '2026-10-25 16:00:00+03'::timestamptz AS instant`;
        assert.equal(
          rows[0]!.instant.toISOString(),
          '2026-10-25T13:00:00.000Z',
        );
      },
    );
    let now = new Date();
    const clock = { now: () => new Date(now) };
    const module = await Test.createTestingModule({
      imports: [AppModule, DatabaseModule, QueueModule, ClockModule],
      providers: [SlaDeadlineService, OutboxDispatcher, QueueRecovery],
    })
      .overrideProvider(RealtimeDispatchRuntime)
      .useValue({})
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    const app = module.createNestApplication({ logger: false });
    const organizations: string[] = [],
      users: string[] = [];
    const producer = app.get(SlaQueue);
    const redis = app.get(RedisService);
    const dispatcher = app.get(OutboxDispatcher);
    const deadlines = app.get(SlaDeadlineService);
    let runtime: WorkerRuntime | undefined;
    async function actor(
      role: OrganizationRole,
      organizationId: string,
      active = true,
    ): Promise<Actor> {
      const user = await db.user.create({
        data: {
          name: `SLA ${role}`,
          email: `${randomUUID()}@example.invalid`,
          passwordHash: 'test-only-no-login',
          isActive: active,
        },
      });
      users.push(user.id);
      const member = await db.organizationMember.create({
        data: { userId: user.id, organizationId, role },
      });
      const session = await db.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return {
        id: member.id,
        userId: user.id,
        organizationId,
        token: await app
          .get(JwtService)
          .signAsync({ sub: user.id, sid: session.id }),
      };
    }
    async function call<T = Record<string, unknown>>(
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
      const value: unknown = await response.json();
      assert.ok(
        !/passwordHash|tokenHash|PrismaClient|"stack"/.test(
          JSON.stringify(value),
        ),
      );
      return { status: response.status, body: value as T };
    }
    try {
      await app.listen(0, '127.0.0.1');
      if (redis.client.status !== 'ready') await once(redis.client, 'ready');
      for (const label of ['a', 'b']) {
        const row = await db.organization.create({
          data: { name: `sla-${label}`, slug: `sla-${randomUUID()}` },
        });
        organizations.push(row.id);
      }
      const owner = await actor('OWNER', organizations[0]!),
        admin = await actor('ADMIN', organizations[0]!),
        manager = await actor('MANAGER', organizations[0]!),
        agent = await actor('AGENT', organizations[0]!),
        viewer = await actor('VIEWER', organizations[0]!),
        foreign = await actor('OWNER', organizations[1]!);
      await actor('MANAGER', owner.organizationId, false);
      const customer = await db.customer.create({
        data: { organizationId: owner.organizationId, name: 'SLA Customer' },
      });
      async function create(priority = 'HIGH') {
        const result = await call<Ticket>('POST', '/tickets', owner, {
          customerId: customer.id,
          subject: 'SLA fixture',
          description: 'No private text in notifications',
          priority,
        });
        assert.equal(result.status, 201);
        return result.body;
      }
      async function events(ticket: Ticket) {
        return db.slaEvent.findMany({
          where: { organizationId: owner.organizationId, ticketId: ticket.id },
          orderBy: { type: 'asc' },
        });
      }
      async function command(
        ticket: Ticket,
        action: string,
        extra: Record<string, unknown> = {},
      ) {
        const result = await call<Ticket>(
          'POST',
          `/tickets/${ticket.id}/${action}`,
          owner,
          { expectedVersion: ticket.version, ...extra },
        );
        assert.equal(result.status, 200);
        return result.body;
      }
      async function working(ticket: Ticket) {
        ticket = await command(ticket, 'triage');
        ticket = await command(ticket, 'assign', {
          assignedMemberId: owner.id,
        });
        return command(ticket, 'start');
      }
      let policy: Policy;
      await t.test(
        'policy API enforces positive durations, tenant scope, RBAC and one active priority',
        async () => {
          const input = {
            name: 'High priority',
            priority: 'HIGH',
            firstResponseMinutes: 1,
            resolutionMinutes: 2,
            isActive: true,
          };
          const result = await call<Policy>(
            'POST',
            '/sla/policies',
            owner,
            input,
          );
          assert.equal(result.status, 201);
          policy = result.body;
          assert.equal(
            (await call('POST', '/sla/policies', admin, input)).status,
            409,
          );
          assert.equal(
            (
              await call('POST', '/sla/policies', owner, {
                ...input,
                firstResponseMinutes: 0,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, owner, {
                resolutionMinutes: -1,
              })
            ).status,
            400,
          );
          for (const who of [manager, agent, viewer])
            assert.equal(
              (
                await call('POST', '/sla/policies', who, {
                  ...input,
                  isActive: false,
                })
              ).status,
              403,
            );
          for (const who of [manager, agent, viewer])
            assert.equal((await call('GET', '/sla/policies', who)).status, 200);
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, foreign, {
                name: 'Intrusion',
              })
            ).status,
            404,
          );
          assert.equal(
            (await call('GET', '/sla/policies', foreign)).body.pagination !==
              undefined,
            true,
          );
          const inactive = await call<Policy>('POST', '/sla/policies', owner, {
            ...input,
            isActive: false,
          });
          assert.equal(inactive.status, 201);
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${inactive.body.id}`, owner, {
                isActive: true,
              })
            ).status,
            409,
          );
        },
      );
      const ticket = await create();
      const initial = await events(ticket);
      await t.test(
        'ticket transaction creates exact deadlines and two typed outbox records; missing policy creates none',
        async () => {
          assert.equal(initial.length, 2);
          const start = new Date(ticket.createdAt).getTime();
          assert.equal(
            initial
              .find((row) => row.type === 'FIRST_RESPONSE')!
              .dueAt.getTime(),
            start + 60000,
          );
          assert.equal(
            initial.find((row) => row.type === 'RESOLUTION')!.dueAt.getTime(),
            start + 120000,
          );
          assert.equal(
            await db.outboxEvent.count({
              where: {
                type: { in: ['SLA_EVENT_SCHEDULED', 'SLA_EVENT_COMPLETED'] },
                organizationId: owner.organizationId,
                slaEventId: { in: initial.map((row) => row.id) },
              },
            }),
            2,
          );
          const noPolicy = await create('LOW');
          assert.equal((await events(noPolicy)).length, 0);
          const detail = await call<Ticket>(
            'GET',
            `/tickets/${ticket.id}`,
            owner,
          );
          assert.equal(detail.body.sla.length, 2);
          assert.ok(detail.body.sla.every((row) => row.status === 'PENDING'));
        },
      );
      await t.test(
        'policy edits are non-retroactive and new tickets use the new durations',
        async () => {
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, admin, {
                firstResponseMinutes: 3,
              })
            ).status,
            200,
          );
          const newer = await create();
          const rows = await events(newer);
          assert.equal(
            rows.find((row) => row.type === 'FIRST_RESPONSE')!.dueAt.getTime(),
            new Date(newer.createdAt).getTime() + 180000,
          );
          assert.equal(
            (await events(ticket))[0]!.dueAt.getTime(),
            initial[0]!.dueAt.getTime(),
          );
          assert.equal(
            (
              await call('PATCH', `/sla/policies/${policy.id}`, owner, {
                firstResponseMinutes: 1,
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        'INTERNAL does not satisfy response; first PUBLIC completes once, atomically and with audit',
        async () => {
          now = new Date(new Date(ticket.createdAt).getTime() + 1000);
          assert.equal(
            (
              await call('POST', `/tickets/${ticket.id}/comments`, owner, {
                body: 'Internal',
                visibility: 'INTERNAL',
              })
            ).status,
            201,
          );
          assert.equal(
            (await events(ticket)).find((row) => row.type === 'FIRST_RESPONSE')!
              .completedAt,
            null,
          );
          const results = await Promise.all([
            call('POST', `/tickets/${ticket.id}/comments`, owner, {
              body: 'Public A',
              visibility: 'PUBLIC',
            }),
            call('POST', `/tickets/${ticket.id}/comments`, owner, {
              body: 'Public B',
              visibility: 'PUBLIC',
            }),
          ]);
          assert.ok(results.every((row) => row.status === 201));
          const first = (await events(ticket)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          assert.equal(first.completedAt!.getTime(), now.getTime());
          now = new Date(now.getTime() + 1000);
          await call('POST', `/tickets/${ticket.id}/comments`, owner, {
            body: 'Public C',
            visibility: 'PUBLIC',
          });
          assert.equal(
            (await events(ticket))
              .find((row) => row.id === first.id)!
              .completedAt!.getTime(),
            first.completedAt!.getTime(),
          );
          assert.equal(
            await db.auditLog.count({
              where: {
                organizationId: owner.organizationId,
                entityId: first.id,
                action: 'SLA_FIRST_RESPONSE_COMPLETED',
              },
            }),
            1,
          );
          assert.equal(
            (await deadlines.process(first.id, 'FIRST_RESPONSE')).state,
            'noop',
          );
        },
      );
      await t.test(
        'RESOLVED completes resolution in the lifecycle transaction; CLOSED does not overwrite it',
        async () => {
          let current = await working(await create());
          const event = (await events(current)).find(
            (row) => row.type === 'RESOLUTION',
          )!;
          now = new Date(event.dueAt.getTime() - 1000);
          current = await command(current, 'resolve');
          const completed = await db.slaEvent.findUniqueOrThrow({
            where: { id: event.id },
          });
          assert.equal(completed.completedAt!.getTime(), now.getTime());
          now = new Date(now.getTime() + 1000);
          current = await command(current, 'close');
          assert.equal(
            (
              await db.slaEvent.findUniqueOrThrow({ where: { id: event.id } })
            ).completedAt!.getTime(),
            completed.completedAt!.getTime(),
          );
        },
      );
      await t.test(
        'early, missing, completed, cancelled and already-breached deadline processing is safe',
        async () => {
          const current = await create();
          const first = (await events(current))[0]!;
          now = new Date(first.dueAt.getTime() - 1);
          assert.equal(
            (await deadlines.process(first.id, first.type)).state,
            'early',
          );
          assert.equal(
            (await deadlines.process(randomUUID(), 'FIRST_RESPONSE')).state,
            'noop',
          );
          await command(current, 'cancel', { reason: 'Cancelled SLA fixture' });
          now = new Date(first.dueAt.getTime() + 1);
          assert.equal(
            (await deadlines.process(first.id, first.type)).state,
            'noop',
          );
          assert.equal(
            (await call<Ticket>('GET', `/tickets/${current.id}`, owner)).body
              .sla[0]!.status,
            'CANCELLED',
          );
        },
      );
      let breachedEvent: SlaEvent;
      let breachedTicket: Ticket;
      await t.test(
        'duplicate concurrent breach processing sets one timestamp and deduplicated correct recipients',
        async () => {
          breachedTicket = await create();
          const current = await command(breachedTicket, 'triage');
          await command(current, 'assign', { assignedMemberId: owner.id });
          breachedEvent = (await events(breachedTicket)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          now = new Date(breachedEvent.dueAt.getTime() + 10);
          const results = await Promise.all([
            deadlines.process(breachedEvent.id, 'FIRST_RESPONSE'),
            deadlines.process(breachedEvent.id, 'FIRST_RESPONSE'),
          ]);
          assert.deepEqual(results.map((row) => row.state).sort(), [
            'breached',
            'noop',
          ]);
          const notifications = await db.notification.findMany({
            where: {
              organizationId: owner.organizationId,
              entityId: breachedTicket.id,
              type: 'SLA_FIRST_RESPONSE_BREACHED',
            },
          });
          assert.deepEqual(
            notifications.map((row) => row.recipientMemberId).sort(),
            [owner.id, admin.id, manager.id].sort(),
          );
          assert.equal(
            await db.auditLog.count({
              where: {
                organizationId: owner.organizationId,
                entityId: breachedEvent.id,
                action: 'SLA_FIRST_RESPONSE_BREACHED',
              },
            }),
            1,
          );
          assert.ok(
            notifications.every(
              (row) =>
                !row.message.includes('private') && row.entityType === 'Ticket',
            ),
          );
          assert.equal(
            (await deadlines.process(breachedEvent.id, 'FIRST_RESPONSE')).state,
            'noop',
          );
        },
      );
      await t.test(
        'late PUBLIC reply and late resolution preserve breach timestamps',
        async () => {
          const before = (
            await db.slaEvent.findUniqueOrThrow({
              where: { id: breachedEvent.id },
            })
          ).breachedAt!;
          now = new Date(before.getTime() + 1000);
          await call('POST', `/tickets/${breachedTicket.id}/comments`, owner, {
            body: 'Late reply',
            visibility: 'PUBLIC',
          });
          let event = await db.slaEvent.findUniqueOrThrow({
            where: { id: breachedEvent.id },
          });
          assert.equal(event.breachedAt!.getTime(), before.getTime());
          assert.ok(event.completedAt);
          let current = await working(await create());
          event = (await events(current)).find(
            (row) => row.type === 'RESOLUTION',
          )!;
          now = new Date(event.dueAt.getTime() + 1);
          await deadlines.process(event.id, 'RESOLUTION');
          const breached = (
            await db.slaEvent.findUniqueOrThrow({ where: { id: event.id } })
          ).breachedAt!;
          now = new Date(now.getTime() + 1000);
          current = await command(current, 'resolve');
          event = await db.slaEvent.findUniqueOrThrow({
            where: { id: event.id },
          });
          assert.ok(event.completedAt);
          assert.equal(event.breachedAt!.getTime(), breached.getTime());
        },
      );
      await t.test(
        'late completion during worker outage emits reconciliation and cannot erase a missed breach',
        async () => {
          const current = await create();
          const event = (await events(current)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          now = new Date(event.dueAt.getTime() + 1);
          await call('POST', `/tickets/${current.id}/comments`, owner, {
            body: 'Late while worker unavailable',
            visibility: 'PUBLIC',
          });
          assert.equal(
            (await deadlines.process(event.id, 'FIRST_RESPONSE')).state,
            'noop',
          );
          assert.equal(
            await db.outboxEvent.count({
              where: {
                slaEventId: event.id,
                type: 'SLA_EVENT_COMPLETED',
              },
            }),
            1,
          );
          assert.equal(
            (await deadlines.process(event.id, null, true)).state,
            'breached',
          );
          assert.equal(
            (await deadlines.process(event.id, null, true)).state,
            'noop',
          );
        },
      );
      await t.test(
        'assigned agent is included, team members/viewers/foreign/inactive members are not broadcast recipients',
        async () => {
          let current = await command(await create(), 'triage');
          current = await command(current, 'assign', {
            assignedMemberId: agent.id,
          });
          const event = (await events(current)).find(
            (row) => row.type === 'RESOLUTION',
          )!;
          now = new Date(event.dueAt.getTime() + 1);
          await deadlines.process(event.id, 'RESOLUTION');
          const rows = await db.notification.findMany({
            where: {
              organizationId: owner.organizationId,
              entityId: current.id,
              type: 'SLA_RESOLUTION_BREACHED',
            },
          });
          assert.deepEqual(
            rows.map((row) => row.recipientMemberId).sort(),
            [owner.id, admin.id, manager.id, agent.id].sort(),
          );
        },
      );
      await t.test(
        'notification API is recipient scoped, paginated, and mark-read is idempotent',
        async () => {
          const rows = await call<{
            data: Array<{ id: string; readAt: string | null }>;
            pagination: { total: number };
          }>('GET', '/notifications?unread=true&limit=1', owner);
          assert.equal(rows.status, 200);
          assert.equal(rows.body.data.length, 1);
          assert.ok(rows.body.pagination.total > 0);
          const id = rows.body.data[0]!.id;
          const first = await call<{ readAt: string }>(
            'PATCH',
            `/notifications/${id}/read`,
            owner,
            {},
          );
          assert.equal(first.status, 200);
          now = new Date(now.getTime() + 1000);
          const second = await call<{ readAt: string }>(
            'PATCH',
            `/notifications/${id}/read`,
            owner,
            {},
          );
          assert.equal(second.body.readAt, first.body.readAt);
          assert.equal(
            (await call('PATCH', `/notifications/${id}/read`, manager, {}))
              .status,
            404,
          );
          assert.equal(
            (await call('PATCH', `/notifications/${id}/read`, foreign, {}))
              .status,
            404,
          );
          const read = await call<{ data: Array<{ id: string }> }>(
            'GET',
            '/notifications?unread=false',
            owner,
          );
          assert.ok(read.body.data.some((row) => row.id === id));
          assert.equal(
            (await call('GET', '/notifications?limit=101', owner)).status,
            400,
          );
          assert.equal(
            (await call('GET', '/notifications?unread=maybe', owner)).status,
            400,
          );
          const foreignList = await call<{ data: unknown[] }>(
            'GET',
            '/notifications',
            foreign,
          );
          assert.equal(foreignList.body.data.length, 0);
        },
      );
      await t.test(
        'queue connection outage leaves committed tickets and retryable outbox intact; recovery dispatches once',
        async () => {
          redis.client.disconnect();
          const current = await create();
          const event = (await events(current))[0]!;
          now = new Date(Date.now() + 10000);
          await dispatcher.dispatchBatch();
          const row = await db.outboxEvent.findUniqueOrThrow({
            where: {
              slaEventId_type: {
                slaEventId: event.id,
                type: 'SLA_EVENT_SCHEDULED',
              },
            },
          });
          assert.equal(row.processedAt, null);
          assert.ok(row.attempts >= 1);
          assert.equal(row.lastError, 'QUEUE_DELIVERY_FAILED');
          await redis.client.connect();
          now = new Date(now.getTime() + 301000);
          for (let i = 0; i < 5; i++) {
            if (!(await dispatcher.dispatchBatch())) break;
          }
          assert.ok(
            (await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } }))
              .processedAt,
          );
          const job = await producer.queue.getJob(
            jobId(event.id, 'SLA_EVENT_SCHEDULED'),
          );
          assert.ok(job);
          assert.deepEqual(Object.keys(job.data), ['slaEventId']);
          const attempts = (
            await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })
          ).attempts;
          await dispatcher.dispatchBatch();
          assert.equal(
            (await db.outboxEvent.findUniqueOrThrow({ where: { id: row.id } }))
              .attempts,
            attempts,
          );
        },
      );
      await t.test(
        'concurrent outbox dispatchers and crash-window replay retain one deterministic queue job',
        async () => {
          const current = await create();
          const event = (await events(current))[0]!;
          now = new Date(Date.now() + 1000);
          const another = new OutboxDispatcher(db, producer, clock);
          await Promise.all([
            dispatcher.dispatchBatch(),
            another.dispatchBatch(),
          ]);
          const id = jobId(event.id, 'SLA_EVENT_SCHEDULED');
          assert.ok(await producer.queue.getJob(id));
          await db.outboxEvent.update({
            where: {
              slaEventId_type: {
                slaEventId: event.id,
                type: 'SLA_EVENT_SCHEDULED',
              },
            },
            data: { processedAt: null, nextAttemptAt: now },
          });
          await dispatcher.dispatchBatch();
          assert.ok(await producer.queue.getJob(id));
          const jobs = await producer.queue.getJobs([
            'waiting',
            'delayed',
            'completed',
            'failed',
          ]);
          assert.equal(jobs.filter((job) => job.id === id).length, 1);
        },
      );
      await t.test(
        'outbox insertion failure rolls back ticket, SLA events and allocated number',
        async () => {
          const name = `test_outbox_${randomUUID().replaceAll('-', '')}`;
          const trigger = `trigger_${name}`;
          const count = await db.ticket.count({
            where: { organizationId: owner.organizationId },
          });
          const number = (
            await db.organizationTicketCounter.findUniqueOrThrow({
              where: { organizationId: owner.organizationId },
            })
          ).lastNumber;
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${owner.organizationId}'::uuid THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$`,
          );
          try {
            await db.$executeRawUnsafe(
              `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
            );
            try {
              assert.equal(
                (
                  await call('POST', '/tickets', owner, {
                    customerId: customer.id,
                    subject: 'Rollback',
                    description: 'Rollback',
                    priority: 'HIGH',
                  })
                ).status,
                500,
              );
            } finally {
              await db.$executeRawUnsafe(
                `DROP TRIGGER "${trigger}" ON "OutboxEvent"`,
              );
            }
          } finally {
            await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
          }
          assert.equal(
            await db.ticket.count({
              where: { organizationId: owner.organizationId },
            }),
            count,
          );
          assert.equal(
            (
              await db.organizationTicketCounter.findUniqueOrThrow({
                where: { organizationId: owner.organizationId },
              })
            ).lastNumber,
            number,
          );
        },
      );
      await t.test(
        'failed SLA completion audit rolls back its PUBLIC comment and completion timestamp',
        async () => {
          const current = await create();
          const event = (await events(current)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          now = new Date(event.dueAt.getTime() - 1000);
          const name = `test_completion_${randomUUID().replaceAll('-', '')}`,
            trigger = `trigger_${name}`;
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${owner.organizationId}'::uuid AND NEW."action"='SLA_FIRST_RESPONSE_COMPLETED' THEN RAISE EXCEPTION 'test completion failure'; END IF; RETURN NEW; END $$`,
          );
          try {
            await db.$executeRawUnsafe(
              `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
            );
            try {
              assert.equal(
                (
                  await call('POST', `/tickets/${current.id}/comments`, owner, {
                    body: 'Must rollback',
                    visibility: 'PUBLIC',
                  })
                ).status,
                500,
              );
            } finally {
              await db.$executeRawUnsafe(
                `DROP TRIGGER "${trigger}" ON "AuditLog"`,
              );
            }
          } finally {
            await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
          }
          assert.equal(
            (await db.slaEvent.findUniqueOrThrow({ where: { id: event.id } }))
              .completedAt,
            null,
          );
          assert.equal(
            await db.ticketComment.count({
              where: {
                organizationId: owner.organizationId,
                ticketId: current.id,
              },
            }),
            0,
          );
        },
      );
      await t.test(
        'failed breach audit rolls back timestamp and notifications, then a retry succeeds once',
        async () => {
          const current = await create();
          const event = (await events(current)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          now = new Date(event.dueAt.getTime() + 1);
          const name = `test_breach_${randomUUID().replaceAll('-', '')}`,
            trigger = `trigger_${name}`;
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${owner.organizationId}'::uuid AND NEW."action"='SLA_FIRST_RESPONSE_BREACHED' THEN RAISE EXCEPTION 'test breach failure'; END IF; RETURN NEW; END $$`,
          );
          try {
            await db.$executeRawUnsafe(
              `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
            );
            try {
              await assert.rejects(
                deadlines.process(event.id, 'FIRST_RESPONSE'),
              );
            } finally {
              await db.$executeRawUnsafe(
                `DROP TRIGGER "${trigger}" ON "AuditLog"`,
              );
            }
          } finally {
            await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
          }
          assert.equal(
            (await db.slaEvent.findUniqueOrThrow({ where: { id: event.id } }))
              .breachedAt,
            null,
          );
          assert.equal(
            await db.notification.count({
              where: {
                organizationId: owner.organizationId,
                entityId: current.id,
              },
            }),
            0,
          );
          assert.equal(
            (await deadlines.process(event.id, 'FIRST_RESPONSE')).state,
            'breached',
          );
          assert.equal(
            (await deadlines.process(event.id, 'FIRST_RESPONSE')).state,
            'noop',
          );
          assert.equal(
            await db.notification.count({
              where: {
                organizationId: owner.organizationId,
                entityId: current.id,
              },
            }),
            3,
          );
        },
      );
      await t.test(
        'processed terminal outbox rows expire while unfinished work remains recoverable',
        async () => {
          const current = await create();
          const pending = (await events(current))[0]!;
          const terminal = initial.find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          await db.outboxEvent.updateMany({
            where: {
              organizationId: owner.organizationId,
              processedAt: { not: null },
            },
            data: { processedAt: new Date(now.getTime() - 8 * 86400000) },
          });
          await dispatcher.cleanupProcessed();
          assert.equal(
            await db.outboxEvent.count({ where: { slaEventId: terminal.id } }),
            0,
          );
          assert.equal(
            await db.outboxEvent.count({
              where: {
                type: { in: ['SLA_EVENT_SCHEDULED', 'SLA_EVENT_COMPLETED'] },
                slaEventId: pending.id,
                processedAt: null,
              },
            }),
            1,
          );
          assert.ok(
            (await db.outboxEvent.count({
              where: {
                type: { in: ['SLA_EVENT_SCHEDULED', 'SLA_EVENT_COMPLETED'] },
                organizationId: owner.organizationId,
                processedAt: { not: null },
              },
            })) > 0,
          );
        },
      );
      await t.test(
        'operator replay restores a missing Redis deadline job from the retained outbox',
        async () => {
          const current = await create();
          const event = (await events(current))[0]!;
          now = new Date(Date.now() + 1000);
          await dispatcher.dispatchBatch();
          const id = jobId(event.id, 'SLA_EVENT_SCHEDULED');
          const job = await producer.queue.getJob(id);
          assert.ok(job);
          await job.remove();
          await app.get(QueueRecovery).replay();
          assert.ok(await producer.queue.getJob(id));
        },
      );
      await t.test(
        'real BullMQ worker processes a delayed short test deadline, retries transient failure and shuts down',
        async () => {
          const current = await create();
          const event = (await events(current)).find(
            (row) => row.type === 'FIRST_RESPONSE',
          )!;
          const dueAt = new Date(Date.now() + 500);
          await db.slaEvent.update({
            where: { id: event.id },
            data: { dueAt },
          });
          now = new Date();
          await producer.queue.pause();
          const actualDeadlines = new SlaDeadlineService(db, new Clock());
          const process = actualDeadlines.process.bind(actualDeadlines);
          let transient = true;
          const stub = mock.method(
            actualDeadlines,
            'process',
            async (
              id: string,
              type: Parameters<typeof process>[1],
              completion?: boolean,
            ) => {
              if (id === event.id && transient) {
                transient = false;
                throw new Error('Test transient dependency failure');
              }
              return process(id, type, completion);
            },
          );
          runtime = new WorkerRuntime(
            app.get(ConfigService),
            dispatcher,
            actualDeadlines,
            redis,
          );
          await runtime.onApplicationBootstrap();
          const runtimeWorker = runtime.worker!;
          const completed = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Real worker completion timed out')),
              15000,
            );
            runtimeWorker.on('completed', (job) => {
              if (job.data.slaEventId === event.id) {
                clearTimeout(timer);
                resolve();
              }
            });
            runtimeWorker.on('failed', (job) => {
              if (job?.data.slaEventId === event.id && job.attemptsMade >= 7) {
                clearTimeout(timer);
                reject(new Error('Real worker terminal failure'));
              }
            });
          });
          await producer.queue.resume();
          await completed;
          stub.mock.restore();
          const processed = await db.slaEvent.findUniqueOrThrow({
            where: { id: event.id },
          });
          assert.ok(processed.breachedAt);
          assert.ok(processed.breachedAt.getTime() >= dueAt.getTime());
          const job = await producer.queue.getJob(
            jobId(event.id, 'SLA_EVENT_SCHEDULED'),
          );
          assert.equal(job!.attemptsMade, 2);
          assert.equal(
            await db.notification.count({
              where: {
                organizationId: owner.organizationId,
                entityId: current.id,
                type: 'SLA_FIRST_RESPONSE_BREACHED',
              },
            }),
            3,
          );
          await runtime.onModuleDestroy();
          runtime = undefined;
        },
      );
    } finally {
      try {
        await runtime?.onModuleDestroy();
        if (redis.client.status === 'ready')
          await producer.queue.obliterate({ force: true });
        await db.$transaction(async (tx) => {
          const where = { organizationId: { in: organizations } };
          await tx.outboxEvent.deleteMany({ where });
          await tx.slaEvent.deleteMany({ where });
          await tx.notification.deleteMany({ where });
          await tx.ticketComment.deleteMany({ where });
          await tx.ticketStatusHistory.deleteMany({ where });
          await tx.ticketAssignment.deleteMany({ where });
          await tx.auditLog.deleteMany({ where });
          await tx.ticket.deleteMany({ where });
          await tx.organizationTicketCounter.deleteMany({ where });
          await tx.slaPolicy.deleteMany({ where });
          await tx.customer.deleteMany({ where });
          await tx.teamMember.deleteMany({ where });
          await tx.team.deleteMany({ where });
          await tx.organizationMember.deleteMany({ where });
          await tx.refreshToken.deleteMany({
            where: { userId: { in: users } },
          });
          await tx.organization.deleteMany({
            where: { id: { in: organizations } },
          });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      } finally {
        await app.close();
      }
    }
  },
);
