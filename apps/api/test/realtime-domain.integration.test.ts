import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ClockModule } from '../src/common/clock.module';
import { RealtimeRoomService } from '../src/modules/realtime/realtime-room.service';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createNotifications } from '../src/infrastructure/outbox/realtime-records';
import { REALTIME_OUTBOX_TYPES } from '../src/infrastructure/outbox/outbox-types';
import { SlaDeadlineService } from '../src/modules/sla/sla-deadline.service';
import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import { RealtimeDispatcher } from '../src/modules/realtime/realtime-dispatcher.service';
import { RealtimeEmitter } from '../src/modules/realtime/realtime-emitter.service';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { configureRealtime } from '../src/modules/realtime/realtime-adapter';
import { REALTIME } from '../src/modules/realtime/realtime-events';
import { DOMAIN_EVENTS } from '../src/modules/realtime/realtime-domain-events';
import type {
  OrganizationRole,
  OutboxEventType,
} from '../src/generated/prisma/client';
interface Hint {
  eventId: string;
  organizationId: string;
  ticketId?: string;
  notificationId?: string;
  version?: number;
  fromStatus?: string;
  toStatus?: string;
  [key: string]: unknown;
}
interface Ticket {
  id: string;
  version: number;
}
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'outbox-backed realtime domain hints over real Socket.IO and PostgreSQL',
  { skip: !databaseUrl && 'Set dedicated TEST_DATABASE_URL', timeout: 60000 },
  async (t) => {
    const db = new PrismaService(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    const module = await Test.createTestingModule({
      imports: [AppModule, DatabaseModule, ClockModule],
      providers: [SlaDeadlineService],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(RealtimeDispatchRuntime)
      .useValue({})
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureRealtime(app);
    const users: string[] = [],
      orgIds: string[] = [],
      sockets: Socket[] = [];
    const received = new Map<Socket, Array<{ name: string; data: Hint }>>();
    try {
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl(),
        jwt = app.get(JwtService),
        dispatcher = app.get(RealtimeDispatcher),
        emitter = app.get(RealtimeEmitter);
      async function org() {
        const row = await db.organization.create({
          data: {
            name: 'Broadcast fixture',
            slug: `rt-domain-${randomUUID()}`,
          },
        });
        orgIds.push(row.id);
        return row.id;
      }
      async function actor(
        organizationId: string,
        role: OrganizationRole = 'OWNER',
      ) {
        const user = await db.user.create({
          data: {
            email: `${randomUUID()}@example.invalid`,
            name: 'Broadcast actor',
            passwordHash: 'unused-fixture',
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
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        return {
          organizationId,
          member,
          user,
          session,
          token: await jwt.signAsync({ sub: user.id, sid: session.id }),
        };
      }
      const orgA = await org(),
        orgB = await org();
      const a = await actor(orgA),
        a2 = await actor(orgA, 'VIEWER'),
        b = await actor(orgB),
        agent = await actor(orgA, 'AGENT');
      const customer = await db.customer.create({
        data: { organizationId: orgA, name: 'Broadcast customer' },
      });
      async function connect(
        person: typeof a,
        organizationId = person.organizationId,
      ) {
        const socket = io(`${url}${REALTIME.NAMESPACE}`, {
          autoConnect: false,
          transports: ['websocket'],
          auth: { token: person.token },
          reconnection: false,
          timeout: 3000,
        });
        sockets.push(socket);
        received.set(socket, []);
        socket.onAny((name: string, data: Hint) => {
          if (Object.values(DOMAIN_EVENTS).some((e) => e === name))
            received.get(socket)!.push({ name, data });
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Connection timed out')),
            4000,
          );
          socket.once(REALTIME.READY, () => {
            clearTimeout(timer);
            resolve();
          });
          socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          socket.connect();
        });
        await select(socket, organizationId);
        return socket;
      }
      function select(socket: Socket, organizationId: string): Promise<void> {
        return new Promise((resolve, reject) =>
          socket
            .timeout(3000)
            .emit(
              REALTIME.JOIN,
              { organizationId },
              (error: Error | null, response: { ok: boolean }) => {
                if (error) return reject(error);
                assert.equal(response.ok, true);
                resolve();
              },
            ),
        );
      }
      const sa = await connect(a),
        sa2 = await connect(a2),
        sb = await connect(b),
        sag = await connect(agent);
      async function barrier(socket: Socket) {
        if (!socket.connected) return;
        // Acknowledgement follows earlier packets on this transport; no sleep-based negative assertions.
        const tenant = app.get(RealtimeGateway).server.sockets.get(socket.id!)
          ?.data.tenant;
        if (tenant) await select(socket, tenant.organizationId);
      }
      async function dispatch() {
        for (let batch = 0; batch < 100; batch++) {
          if ((await dispatcher.dispatchBatch()) < 25) break;
        }
        for (const socket of sockets) await barrier(socket);
      }
      function hints(socket: Socket, name?: string, ticketId?: string) {
        return received
          .get(socket)!
          .filter(
            (e) =>
              (!name || e.name === name) &&
              (!ticketId || e.data.ticketId === ticketId),
          );
      }
      async function request<T>(
        method: string,
        path: string,
        body?: unknown,
        person = a,
      ) {
        const r = await fetch(`${url}${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${person.token}`,
            'x-organization-id': person.organizationId,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: r.status, body: (await r.json()) as T };
      }
      async function create(priority = 'MEDIUM') {
        const r = await request<Ticket>('POST', '/tickets', {
          customerId: customer.id,
          subject: 'Safe ticket',
          description: 'secret description must never be broadcast',
          priority,
        });
        assert.equal(r.status, 201);
        return r.body;
      }
      async function command(
        ticket: Ticket,
        action: string,
        extra: object = {},
      ) {
        const r = await request<Ticket>(
          'POST',
          `/tickets/${ticket.id}/${action}`,
          { expectedVersion: ticket.version, ...extra },
        );
        assert.equal(r.status, 200);
        return r.body;
      }
      async function rows(ticketId: string) {
        return db.outboxEvent.findMany({
          where: { ticketId },
          orderBy: { createdAt: 'asc' },
        });
      }
      let ticket!: Ticket;
      await t.test(
        'ticket create commits one minimal stable hint only to authorized same-organization sockets',
        async () => {
          ticket = await create();
          const outbox = await rows(ticket.id);
          assert.equal(outbox.length, 1);
          assert.equal(outbox[0]!.type, 'TICKET_CREATED');
          assert.equal(outbox[0]!.processedAt, null);
          await dispatch();
          const event = hints(sa, DOMAIN_EVENTS.CREATED, ticket.id)[0]!;
          assert.equal(event.data.eventId, outbox[0]!.id);
          assert.equal(event.data.version, 0);
          assert.equal(event.data.schemaVersion, 1);
          assert.equal(event.data.status, 'OPEN');
          assert.equal(hints(sa2, DOMAIN_EVENTS.CREATED, ticket.id).length, 1);
          assert.equal(hints(sb).length, 0);
          assert.equal(hints(sag).length, 0);
          assert.ok(
            !/description|subject|password|token|history/.test(
              JSON.stringify(event.data),
            ),
          );
          const count = hints(sa).length;
          await dispatch();
          assert.equal(hints(sa).length, count);
        },
      );
      await t.test(
        'lifecycle conflict/invalid commands emit nothing and competing versions produce one winner event',
        async () => {
          const responses = await Promise.all([
            request<Ticket>('POST', `/tickets/${ticket.id}/triage`, {
              expectedVersion: 0,
            }),
            request<Ticket>('POST', `/tickets/${ticket.id}/triage`, {
              expectedVersion: 0,
            }),
          ]);
          assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
          ticket = responses.find((r) => r.status === 200)!.body;
          assert.equal(
            (
              await request('POST', `/tickets/${ticket.id}/resolve`, {
                expectedVersion: ticket.version,
              })
            ).status,
            409,
          );
          await dispatch();
          const events = hints(sa, DOMAIN_EVENTS.STATUS, ticket.id);
          assert.equal(events.length, 1);
          assert.equal(events[0]!.data.fromStatus, 'OPEN');
          assert.equal(events[0]!.data.toStatus, 'TRIAGED');
          assert.equal(events[0]!.data.version, 1);
        },
      );
      await t.test(
        'assignment and reassignment commit distinct events; stale assignment produces none',
        async () => {
          ticket = await command(ticket, 'assign', {
            assignedMemberId: agent.member.id,
          });
          assert.equal(
            (
              await request('POST', `/tickets/${ticket.id}/assign`, {
                expectedVersion: ticket.version - 1,
                assignedMemberId: a.member.id,
              })
            ).status,
            409,
          );
          await dispatch();
          assert.equal(hints(sa, DOMAIN_EVENTS.ASSIGNED, ticket.id).length, 1);
          assert.equal(hints(sag, DOMAIN_EVENTS.ASSIGNED, ticket.id).length, 1);
          assert.equal(hints(sa, DOMAIN_EVENTS.STATUS, ticket.id).length, 2);
          assert.equal(hints(sb).length, 0);
          ticket = await command(ticket, 'assign', {
            assignedMemberId: a.member.id,
          });
          await dispatch();
          const event = hints(sa, DOMAIN_EVENTS.ASSIGNED, ticket.id).at(
            -1,
          )!.data;
          assert.equal(event.previousMemberId, agent.member.id);
          assert.equal(event.assignedMemberId, a.member.id);
          assert.equal(hints(sag, DOMAIN_EVENTS.ASSIGNED, ticket.id).length, 1);
        },
      );
      await t.test(
        'concurrent live revalidations preserve context and live role changes enforce ticket visibility',
        async () => {
          const server = app.get(RealtimeGateway).server.sockets.get(sa.id!)!;
          const rooms = app.get(RealtimeRoomService);
          const contexts = await Promise.all([
            rooms.revalidate(server),
            rooms.revalidate(server),
          ]);
          assert.ok(contexts.every((c) => c.membershipId === a.member.id));
          const watcher = await actor(orgA);
          const watching = await connect(watcher);
          await db.organizationMember.update({
            where: { id: watcher.member.id },
            data: { role: 'AGENT' },
          });
          const current = await create();
          await dispatch();
          assert.equal(
            hints(watching, DOMAIN_EVENTS.CREATED, current.id).length,
            0,
          );
          assert.equal(
            app.get(RealtimeGateway).server.sockets.get(watching.id!)!.data
              .tenant!.role,
            'AGENT',
          );
        },
      );
      await t.test(
        'INTERNAL and PUBLIC comment hints contain IDs and visibility but no body',
        async () => {
          for (const visibility of ['INTERNAL', 'PUBLIC'])
            assert.equal(
              (
                await request('POST', `/tickets/${ticket.id}/comments`, {
                  body: `sensitive ${visibility} body`,
                  visibility,
                })
              ).status,
              201,
            );
          await dispatch();
          const events = hints(sa, DOMAIN_EVENTS.COMMENT, ticket.id);
          assert.equal(events.length, 2);
          for (const e of events) {
            assert.equal(e.data.version, ticket.version);
            assert.equal(typeof e.data.commentId, 'string');
            assert.equal(e.data.authorMemberId, a.member.id);
            assert.ok(!JSON.stringify(e.data).includes('body'));
          }
        },
      );
      await t.test(
        'notification persistence and outbox delivery target only the recipient member',
        async () => {
          await db.$transaction((tx) =>
            createNotifications(tx, [
              {
                organizationId: orgA,
                recipientMemberId: a2.member.id,
                type: 'SYSTEM',
                title: 'Recipient only',
                message: 'Persisted message',
              },
            ]),
          );
          const note = await db.notification.findFirstOrThrow({
            where: { organizationId: orgA, recipientMemberId: a2.member.id },
          });
          await dispatch();
          assert.equal(
            hints(sa2, DOMAIN_EVENTS.NOTIFICATION).filter(
              (e) => e.data.notificationId === note.id,
            ).length,
            1,
          );
          assert.equal(hints(sa, DOMAIN_EVENTS.NOTIFICATION).length, 0);
          assert.equal(hints(sb, DOMAIN_EVENTS.NOTIFICATION).length, 0);
          assert.equal(hints(sag, DOMAIN_EVENTS.NOTIFICATION).length, 0);
          const before = await db.outboxEvent.count({
            where: { notificationId: note.id },
          });
          assert.equal(
            (
              await request(
                'PATCH',
                `/notifications/${note.id}/read`,
                undefined,
                a2,
              )
            ).status,
            200,
          );
          await dispatch();
          assert.equal(
            await db.outboxEvent.count({ where: { notificationId: note.id } }),
            before,
          );
          assert.equal(hints(sa2, DOMAIN_EVENTS.NOTIFICATION).length, 1);
        },
      );
      await t.test(
        'SLA breach atomically persists notification source rows and emits one recipient hint across duplicate jobs',
        async () => {
          await db.slaPolicy.create({
            data: {
              organizationId: orgA,
              name: 'Realtime SLA',
              priority: 'HIGH',
              firstResponseMinutes: 1,
              resolutionMinutes: 2,
            },
          });
          const current = await create('HIGH');
          const event = await db.slaEvent.findFirstOrThrow({
            where: { ticketId: current.id, type: 'FIRST_RESPONSE' },
          });
          await db.slaEvent.update({
            where: { id: event.id },
            data: { dueAt: new Date(Date.now() - 1000) },
          });
          await Promise.all([
            app.get(SlaDeadlineService).process(event.id, 'FIRST_RESPONSE'),
            app.get(SlaDeadlineService).process(event.id, 'FIRST_RESPONSE'),
          ]);
          await dispatch();
          const notes = await db.notification.findMany({
            where: { organizationId: orgA, entityId: current.id },
          });
          assert.equal(notes.length, 1);
          assert.equal(notes[0]!.recipientMemberId, a.member.id);
          assert.equal(
            hints(sa, DOMAIN_EVENTS.NOTIFICATION).filter(
              (e) => e.data.notificationId === notes[0]!.id,
            ).length,
            1,
          );
          assert.equal(hints(sa2, DOMAIN_EVENTS.NOTIFICATION).length, 1);
          assert.equal(
            await db.outboxEvent.count({
              where: {
                notificationId: notes[0]!.id,
                processedAt: { not: null },
              },
            }),
            1,
          );
          assert.equal(
            await db.outboxEvent.count({
              where: { slaEventId: event.id, processedAt: null },
            }),
            1,
          );
        },
      );
      await t.test(
        'notification outbox failure rolls back the breach and all notification rows',
        async () => {
          const current = await create('HIGH');
          const event = await db.slaEvent.findFirstOrThrow({
            where: { ticketId: current.id, type: 'FIRST_RESPONSE' },
          });
          await db.slaEvent.update({
            where: { id: event.id },
            data: { dueAt: new Date(Date.now() - 1000) },
          });
          const name = `rt_note_fail_${randomBytes(6).toString('hex')}`;
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${orgA}'::uuid AND NEW."type"::text='NOTIFICATION_CREATED' THEN RAISE EXCEPTION 'fixture outbox failure'; END IF; RETURN NEW; END $$`,
          );
          await db.$executeRawUnsafe(
            `CREATE TRIGGER "${name}" BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
          );
          try {
            await assert.rejects(
              app.get(SlaDeadlineService).process(event.id, 'FIRST_RESPONSE'),
            );
            assert.equal(
              (await db.slaEvent.findUniqueOrThrow({ where: { id: event.id } }))
                .breachedAt,
              null,
            );
            assert.equal(
              await db.notification.count({ where: { entityId: current.id } }),
              0,
            );
          } finally {
            await db.$executeRawUnsafe(
              `DROP TRIGGER "${name}" ON "OutboxEvent"`,
            );
            await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
          }
        },
      );
      await t.test(
        'transport failure retries the same event ID, concurrent claims serialize, and successful rows do not re-dispatch',
        async () => {
          const current = await create();
          const row = (await rows(current.id))[0]!;
          const stub = mock.method(emitter, 'deliver', async () => {
            throw new Error('private transport detail');
          });
          try {
            await dispatcher.dispatchBatch();
          } finally {
            stub.mock.restore();
          }
          let saved = await db.outboxEvent.findUniqueOrThrow({
            where: { id: row.id },
          });
          assert.equal(saved.processedAt, null);
          assert.equal(saved.lastError, 'REALTIME_DELIVERY_FAILED');
          assert.equal(saved.attempts, 1);
          await db.outboxEvent.update({
            where: { id: row.id },
            data: { nextAttemptAt: new Date(0) },
          });
          await Promise.all([
            dispatcher.dispatchBatch(),
            dispatcher.dispatchBatch(),
          ]);
          for (const s of sockets) await barrier(s);
          assert.deepEqual(
            hints(sa, DOMAIN_EVENTS.CREATED, current.id).map(
              (e) => e.data.eventId,
            ),
            [row.id],
          );
          saved = await db.outboxEvent.findUniqueOrThrow({
            where: { id: row.id },
          });
          assert.ok(saved.processedAt);
          assert.equal(saved.attempts, 2);
          await dispatch();
          assert.equal(hints(sa, DOMAIN_EVENTS.CREATED, current.id).length, 1);
        },
      );
      await t.test(
        'emit-before-mark failure can duplicate delivery with the same stable event ID',
        async () => {
          const current = await create();
          const row = (await rows(current.id))[0]!;
          const original = emitter.deliver.bind(emitter);
          const stub = mock.method(
            emitter,
            'deliver',
            async (...args: Parameters<typeof original>) => {
              await original(...args);
              throw new Error('Simulated crash window');
            },
          );
          try {
            await dispatcher.dispatchBatch();
          } finally {
            stub.mock.restore();
          }
          await db.outboxEvent.update({
            where: { id: row.id },
            data: { nextAttemptAt: new Date(0) },
          });
          await dispatch();
          assert.deepEqual(
            hints(sa, DOMAIN_EVENTS.CREATED, current.id).map(
              (e) => e.data.eventId,
            ),
            [row.id, row.id],
          );
        },
      );
      await t.test(
        'unknown snapshot fields are quarantined without leaking them to clients',
        async () => {
          const current = await create();
          const row = (await rows(current.id))[0]!;
          await db.outboxEvent.update({
            where: { id: row.id },
            data: {
              payload: {
                ...(row.payload as object),
                passwordHash: 'never emit this',
              },
            },
          });
          await dispatch();
          const saved = await db.outboxEvent.findUniqueOrThrow({
            where: { id: row.id },
          });
          assert.ok(saved.failedAt);
          assert.equal(saved.processedAt, null);
          assert.equal(saved.lastError, 'INVALID_REALTIME_EVENT');
          assert.equal(hints(sa, DOMAIN_EVENTS.CREATED, current.id).length, 0);
        },
      );
      await t.test(
        'rolled-back ticket, transition, and comment transactions publish no outbox effects',
        async () => {
          const name = `rt_fail_${randomBytes(6).toString('hex')}`;
          await db.$executeRawUnsafe(
            `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${orgA}'::uuid THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`,
          );
          await db.$executeRawUnsafe(
            `CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
          );
          const count = await db.outboxEvent.count({
            where: { organizationId: orgA },
          });
          try {
            assert.equal(
              (
                await request('POST', '/tickets', {
                  customerId: customer.id,
                  subject: 'Rollback',
                  description: 'Rollback',
                })
              ).status,
              500,
            );
            assert.equal(
              (
                await request('POST', `/tickets/${ticket.id}/start`, {
                  expectedVersion: ticket.version,
                })
              ).status,
              500,
            );
            assert.equal(
              (
                await request('POST', `/tickets/${ticket.id}/comments`, {
                  body: 'Rollback',
                  visibility: 'INTERNAL',
                })
              ).status,
              500,
            );
            assert.equal(
              await db.outboxEvent.count({ where: { organizationId: orgA } }),
              count,
            );
          } finally {
            await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "AuditLog"`);
            await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
          }
        },
      );
      await t.test(
        'removed membership stops receiving broadcasts and is evicted from tenant rooms',
        async () => {
          await db.organizationMember
            .delete({ where: { id: a2.member.id } })
            .catch(async () => {
              // Existing notification rows intentionally restrict deletion; remove only this tracked fixture first.
              await db.outboxEvent.deleteMany({
                where: { notification: { recipientMemberId: a2.member.id } },
              });
              await db.notification.deleteMany({
                where: { recipientMemberId: a2.member.id },
              });
              await db.organizationMember.delete({
                where: { id: a2.member.id },
              });
            });
          const current = await create();
          await dispatch();
          assert.equal(hints(sa2, DOMAIN_EVENTS.CREATED, current.id).length, 0);
          assert.equal(
            app.get(RealtimeGateway).server.sockets.get(sa2.id!)!.data.tenant,
            undefined,
          );
        },
      );
      await t.test(
        'organization switching, session revocation, and deactivation prevent later delivery',
        async () => {
          await db.organizationMember.create({
            data: { organizationId: orgB, userId: a.user.id, role: 'VIEWER' },
          });
          await select(sa, orgB);
          const current = await create();
          await dispatch();
          assert.equal(hints(sa, DOMAIN_EVENTS.CREATED, current.id).length, 0);
          await select(sa, orgA);
          await db.refreshToken.update({
            where: { id: a.session.id },
            data: { revokedAt: new Date() },
          });
          assert.equal(
            (
              await request('POST', '/tickets', {
                customerId: customer.id,
                subject: 'Revoked',
                description: 'Rejected',
              })
            ).status,
            401,
          ); // HTTP mutations also reject the revoked session.
          const serviceTicket = await db.ticket.findUniqueOrThrow({
            where: { id: ticket.id },
          });
          await db.$transaction(async (tx) => {
            const { recordTicketChange } =
              await import('../src/infrastructure/outbox/realtime-records');
            await recordTicketChange(
              tx,
              serviceTicket,
              {
                type: 'TICKET_CREATED',
                status: serviceTicket.status,
                priority: serviceTicket.priority,
              },
              new Date(),
            );
          });
          await dispatcher.dispatchBatch();
          assert.equal(
            app.get(RealtimeGateway).server.sockets.has(sa.id!),
            false,
          );
          await db.refreshToken.update({
            where: { id: a.session.id },
            data: { revokedAt: null },
          });
          const activeSocket = await connect(a);
          await db.user.update({
            where: { id: a.user.id },
            data: { isActive: false },
          });
          await db.$transaction((tx) =>
            createNotifications(tx, [
              {
                organizationId: orgA,
                recipientMemberId: a.member.id,
                type: 'SYSTEM',
                title: 'Inactive',
                message: 'Not delivered',
              },
            ]),
          );
          await dispatcher.dispatchBatch();
          assert.equal(
            app.get(RealtimeGateway).server.sockets.has(activeSocket.id!),
            false,
          );
          await db.user.update({
            where: { id: a.user.id },
            data: { isActive: true },
          });
        },
      );
      await t.test(
        'zero connected recipients counts as delivery and reconnect recovers state through HTTP without replay',
        async () => {
          for (const s of sockets) s.disconnect();
          const current = await create();
          await dispatcher.dispatchBatch();
          assert.ok((await rows(current.id))[0]!.processedAt);
          const reconnect = await connect(a);
          await dispatch();
          assert.equal(
            hints(reconnect, DOMAIN_EVENTS.CREATED, current.id).length,
            0,
          );
          const authoritative = await request<Ticket>(
            'GET',
            `/tickets/${current.id}`,
          );
          assert.equal(authoritative.status, 200);
          assert.equal(authoritative.body.id, current.id);
        },
      );
      await t.test(
        'processed realtime retention is bounded and does not delete pending, failed, or SLA rows',
        async () => {
          const where = {
            organizationId: orgA,
            type: { in: [...REALTIME_OUTBOX_TYPES] },
            processedAt: { not: null },
          };
          await db.outboxEvent.updateMany({
            where,
            data: { processedAt: new Date(Date.now() - 8 * 86400000) },
          });
          await dispatcher.cleanupProcessed();
          assert.equal(await db.outboxEvent.count({ where }), 0);
          assert.ok(
            await db.outboxEvent.count({
              where: { organizationId: orgA, failedAt: { not: null } },
            }),
          );
          assert.ok(
            await db.outboxEvent.count({
              where: {
                organizationId: orgA,
                type: 'SLA_EVENT_SCHEDULED',
                processedAt: null,
              },
            }),
          );
        },
      );
      await t.test(
        'tenant foreign keys and delivery shape reject cross-organization pointers',
        async () => {
          await assert.rejects(
            db.outboxEvent.create({
              data: {
                organizationId: orgB,
                ticketId: ticket.id,
                type: 'TICKET_CREATED',
                payload: {},
              },
            }),
          );
          await assert.rejects(
            db.outboxEvent.create({
              data: {
                organizationId: orgA,
                ticketId: ticket.id,
                type: 'TICKET_CREATED',
              },
            }),
          );
          await assert.rejects(
            db.outboxEvent.create({
              data: {
                organizationId: orgA,
                ticketId: ticket.id,
                type: 'SLA_EVENT_SCHEDULED' as OutboxEventType,
                payload: {},
              },
            }),
          );
        },
      );
    } finally {
      for (const socket of sockets) socket.disconnect();
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
        await tx.organizationTicketCounter.deleteMany({ where });
        await tx.slaPolicy.deleteMany({ where });
        await tx.customer.deleteMany({ where });
        await tx.teamMember.deleteMany({ where });
        await tx.team.deleteMany({ where });
        await tx.refreshToken.deleteMany({ where: { userId: { in: users } } });
        await tx.organizationMember.deleteMany({ where });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
      await app.close();
    }
  },
);
