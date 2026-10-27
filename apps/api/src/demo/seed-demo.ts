import 'reflect-metadata';
import type {
  Prisma,
  OrganizationRole,
  TicketStatus,
} from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { PasswordService } from '../modules/auth/password.service';
import { SlaService } from '../modules/sla/sla.service';
import { Clock } from '../common/clock.module';
import { MANAGERS, OPERATORS } from '../common/domain-transaction.service';
import {
  transitions,
  type Transition,
} from '../modules/tickets/policies/ticket.policy';
import type { TenantContext } from '../modules/auth/types/request-context';
import {
  createNotifications,
  recordTicketChange,
} from '../infrastructure/outbox/realtime-records';
import {
  DEMO_CUSTOMERS,
  DEMO_ORGANIZATION_ID as organizationId,
  DEMO_PASSWORD,
  DEMO_POLICIES,
  DEMO_SLUG,
  DEMO_TEAMS,
  DEMO_TICKETS,
  DEMO_USERS,
  demoId,
} from './manifest';
export class DemoSeedError extends Error {}
export function assertDemoEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    env.NODE_ENV !== undefined &&
    !['development', 'test'].includes(env.NODE_ENV)
  )
    throw new DemoSeedError(
      'Demo seed is allowed only in development or test; production is always refused.',
    );
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new DemoSeedError(
      'Configure a local PostgreSQL DATABASE_URL before seeding.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname.length < 2
  )
    throw new DemoSeedError(
      'Demo seed requires a loopback PostgreSQL database. Remote databases are refused.',
    );
}
class HistoricalClock extends Clock {
  constructor(public at: Date) {
    super();
  }
  override now() {
    return new Date(this.at);
  }
}
async function authorize(
  tx: Prisma.TransactionClient,
  actor: TenantContext,
  roles: readonly OrganizationRole[],
) {
  // Same live membership/activity rule and row locks as DomainTransaction, including imported historical actions.
  const rows = await tx.$queryRaw<
    Array<{ role: OrganizationRole }>
  >`SELECT m."role" FROM "OrganizationMember" m JOIN "User" u ON u."id"=m."userId" WHERE m."id"=${actor.membershipId}::uuid AND m."organizationId"=${actor.organizationId}::uuid AND m."userId"=${actor.userId}::uuid AND u."isActive"=true FOR SHARE OF m,u`;
  if (!rows[0] || rows[0].role !== actor.role || !roles.includes(rows[0].role))
    throw new DemoSeedError(
      'A demo actor no longer has the required permission. Existing accounts were not reset.',
    );
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: TenantContext,
  action: string,
  entityType: string,
  entityId: string,
  at: Date,
  metadata?: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      organizationId,
      actorMemberId: actor.membershipId,
      action,
      entityType,
      entityId,
      createdAt: at,
      ...(metadata ? { metadata } : {}),
    },
  });
}
/** Explicit local provisioning, never imported by AppModule or called by application startup. */
export async function seedDemo(
  db: Pick<PrismaService, '$transaction'>,
  env: NodeJS.ProcessEnv,
  now = new Date(),
) {
  assertDemoEnvironment(env);
  const passwords = new PasswordService();
  const hashes = await Promise.all(
    DEMO_USERS.map(() => passwords.hash(DEMO_PASSWORD)),
  );
  const anchor = new Date(Math.floor(now.getTime() / 60000) * 60000);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(826130, 6)::text AS locked`;
      const existing = await tx.organization.findFirst({
        where: { OR: [{ id: organizationId }, { slug: DEMO_SLUG }] },
      });
      if (
        existing &&
        (existing.id !== organizationId ||
          existing.slug !== DEMO_SLUG ||
          !(await tx.auditLog.findFirst({
            where: {
              id: demoId('manifest:v1'),
              organizationId,
              action: 'DEMO_SEEDED',
            },
          })))
      )
        throw new DemoSeedError(
          'The demo organization identity is already in use or its seed marker is missing. No records were adopted or overwritten.',
        );
      for (const user of DEMO_USERS) {
        const conflict = await tx.user.findFirst({
          where: {
            OR: [{ id: demoId(`user:${user.role}`) }, { email: user.email }],
          },
        });
        if (
          conflict &&
          (!existing ||
            conflict.id !== demoId(`user:${user.role}`) ||
            conflict.email !== user.email)
        )
          throw new DemoSeedError(
            'A demo email or identity is already in use. Existing users were not changed.',
          );
      }
      await tx.organization.upsert({
        where: { id: organizationId },
        update: {},
        create: { id: organizationId, name: 'PulseDesk Demo', slug: DEMO_SLUG },
      });
      const actors = {} as Record<
        (typeof DEMO_USERS)[number]['role'],
        TenantContext
      >;
      for (const [index, user] of DEMO_USERS.entries()) {
        const userId = demoId(`user:${user.role}`),
          membershipId = demoId(`membership:${user.role}`);
        await tx.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            name: user.name,
            email: user.email,
            passwordHash: hashes[index]!,
          },
        });
        await tx.organizationMember.upsert({
          where: { organizationId_userId: { organizationId, userId } },
          update: {},
          create: { id: membershipId, organizationId, userId, role: user.role },
        });
        const member = await tx.organizationMember.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId, userId } },
        });
        actors[user.role] = {
          organizationId,
          userId,
          membershipId: member.id,
          role: member.role,
        };
      }
      for (const name of DEMO_TEAMS)
        await tx.team.upsert({
          where: { id: demoId(`team:${name}`) },
          update: {},
          create: {
            id: demoId(`team:${name}`),
            organizationId,
            name,
            description: 'Yerel geliştirme ve demo ekibi.',
          },
        });
      for (const [team, role] of [
        [0, 'AGENT'],
        [0, 'MANAGER'],
        [1, 'MANAGER'],
      ] as const) {
        const teamId = demoId(`team:${DEMO_TEAMS[team]}`),
          memberId = actors[role].membershipId;
        await tx.teamMember.upsert({
          where: {
            organizationId_teamId_memberId: {
              organizationId,
              teamId,
              memberId,
            },
          },
          update: {},
          create: {
            id: demoId(`team-member:${team}:${role}`),
            organizationId,
            teamId,
            memberId,
          },
        });
      }
      for (const customer of DEMO_CUSTOMERS)
        await tx.customer.upsert({
          where: { id: demoId(`customer:${customer.email}`) },
          update: {},
          create: {
            id: demoId(`customer:${customer.email}`),
            organizationId,
            ...customer,
            companyName: customer.name,
            notes: 'Gerçek müşteri bilgisi içermeyen demo kaydı.',
          },
        });
      for (const policy of DEMO_POLICIES)
        await tx.slaPolicy.upsert({
          where: { id: demoId(`policy:${policy.priority}`) },
          update: {},
          create: {
            id: demoId(`policy:${policy.priority}`),
            organizationId,
            name: `Demo ${policy.priority}`,
            isActive: true,
            ...policy,
          },
        });
      let createdTickets = 0;
      for (const [index, plan] of DEMO_TICKETS.entries()) {
        const id = demoId(`ticket:${index + 1}`);
        const prior = await tx.ticket.findUnique({ where: { id } });
        if (prior) {
          if (prior.organizationId !== organizationId)
            throw new DemoSeedError(
              'A demo ticket identity is already in use.',
            );
          continue;
        }
        const manager = actors.MANAGER;
        await authorize(tx, manager, OPERATORS);
        const numbers = await tx.$queryRaw<
          Array<{ lastNumber: number }>
        >`INSERT INTO "OrganizationTicketCounter" ("organizationId","lastNumber") VALUES (${organizationId}::uuid,1) ON CONFLICT ("organizationId") DO UPDATE SET "lastNumber"="OrganizationTicketCounter"."lastNumber"+1 WHERE "OrganizationTicketCounter"."lastNumber" < 2147483647 RETURNING "lastNumber"`;
        if (!numbers[0])
          throw new DemoSeedError('The demo ticket counter is exhausted.');
        const createdAt = new Date(anchor.getTime() - plan.ageMinutes * 60000);
        let ticket = await tx.ticket.create({
          data: {
            id,
            organizationId,
            customerId: demoId(
              `customer:${DEMO_CUSTOMERS[plan.customer].email}`,
            ),
            ticketNumber: numbers[0].lastNumber,
            subject: plan.subject,
            description: `${plan.subject}. Bu kayıt yerel destek operasyonları demosu için hazırlanmıştır.`,
            priority: plan.priority,
            source: plan.source,
            status: 'OPEN',
            version: 0,
            createdAt,
            updatedAt: createdAt,
          },
        });
        await tx.ticketStatusHistory.create({
          data: {
            organizationId,
            ticketId: id,
            fromStatus: null,
            toStatus: 'OPEN',
            changedByMemberId: manager.membershipId,
            createdAt,
          },
        });
        await audit(tx, manager, 'TICKET_CREATED', 'Ticket', id, createdAt, {
          ticketNumber: ticket.ticketNumber,
        });
        await recordTicketChange(
          tx,
          ticket,
          { type: 'TICKET_CREATED', status: 'OPEN', priority: ticket.priority },
          createdAt,
        );
        const clock = new HistoricalClock(createdAt),
          sla = new SlaService(clock);
        await sla.create(tx, ticket);
        await tx.slaEvent.updateMany({
          where: { organizationId, ticketId: id },
          data: { createdAt },
        });
        for (const [stepIndex, step] of plan.steps.entries()) {
          const at = new Date(
            createdAt.getTime() +
              (step === 'resolve' ? 20 : stepIndex + 1) * 60000,
          );
          clock.at = at;
          const from = ticket.status;
          let to: TicketStatus;
          let actor = manager;
          let action: string;
          if (step === 'assign' && 'member' in plan) {
            await authorize(tx, manager, MANAGERS);
            const assignedMemberId = actors[plan.member].membershipId,
              assignedTeamId = demoId(`team:${DEMO_TEAMS[plan.team]}`);
            if (
              from !== 'TRIAGED' ||
              !(await tx.teamMember.findUnique({
                where: {
                  organizationId_teamId_memberId: {
                    organizationId,
                    teamId: assignedTeamId,
                    memberId: assignedMemberId,
                  },
                },
              }))
            )
              throw new DemoSeedError('Demo assignment is inconsistent.');
            ticket = await tx.ticket.update({
              where: { id, organizationId, version: ticket.version },
              data: {
                assignedMemberId,
                assignedTeamId,
                status: 'ASSIGNED',
                version: { increment: 1 },
                updatedAt: at,
              },
            });
            await tx.ticketAssignment.create({
              data: {
                organizationId,
                ticketId: id,
                assignedMemberId,
                assignedTeamId,
                assignedByMemberId: manager.membershipId,
                createdAt: at,
              },
            });
            await recordTicketChange(
              tx,
              ticket,
              {
                type: 'TICKET_ASSIGNED',
                assignedMemberId,
                assignedTeamId,
                previousMemberId: null,
                previousTeamId: null,
              },
              at,
            );
            to = 'ASSIGNED';
            action = 'TICKET_ASSIGNED';
          } else {
            const rule = transitions[step as Transition];
            if (!rule || from !== rule.from)
              throw new DemoSeedError('Demo lifecycle is inconsistent.');
            actor =
              step === 'triage'
                ? manager
                : 'member' in plan
                  ? actors[plan.member]
                  : manager;
            await authorize(tx, actor, rule.roles);
            if (
              actor.role === 'AGENT' &&
              ticket.assignedMemberId !== actor.membershipId
            )
              throw new DemoSeedError(
                'Demo agent cannot operate another responder’s ticket.',
              );
            to = rule.to;
            action = rule.audit;
            ticket = await tx.ticket.update({
              where: { id, organizationId, version: ticket.version },
              data: {
                status: to,
                version: { increment: 1 },
                updatedAt: at,
                ...(to === 'RESOLVED' ? { resolvedAt: at } : {}),
              },
            });
            if (to === 'RESOLVED')
              await sla.complete(tx, actor, id, 'RESOLUTION');
          }
          await tx.ticketStatusHistory.create({
            data: {
              organizationId,
              ticketId: id,
              fromStatus: from,
              toStatus: to,
              changedByMemberId: actor.membershipId,
              createdAt: at,
            },
          });
          await audit(tx, actor, action, 'Ticket', id, at, {
            fromStatus: from,
            toStatus: to,
          });
          await recordTicketChange(
            tx,
            ticket,
            {
              type: 'TICKET_STATUS_CHANGED',
              fromStatus: from,
              toStatus: to,
              actorMemberId: actor.membershipId,
            },
            at,
          );
        }
        if ('member' in plan) {
          const actor = actors[plan.member];
          await authorize(tx, actor, OPERATORS);
          const publicReply = index >= 3;
          const at = new Date(
            createdAt.getTime() + (publicReply ? 5 : 3) * 60000,
          );
          const comment = await tx.ticketComment.create({
            data: {
              organizationId,
              ticketId: id,
              authorMemberId: actor.membershipId,
              visibility: publicReply ? 'PUBLIC' : 'INTERNAL',
              body: publicReply
                ? index === 4
                  ? 'İlgili ekip çalışmayı sürdürüyor.'
                  : 'Talebinizi aldık, incelemeye başladık.'
                : 'Log kayıtları incelenecek.',
              createdAt: at,
              updatedAt: at,
            },
          });
          clock.at = at;
          if (publicReply) await sla.complete(tx, actor, id, 'FIRST_RESPONSE');
          await audit(tx, actor, 'TICKET_COMMENT_ADDED', 'Ticket', id, at, {
            commentId: comment.id,
            visibility: comment.visibility,
          });
          // Comments retain the workflow version at their actual historical timestamp.
          const commentVersion = index === 5 ? 3 : ticket.version;
          await recordTicketChange(
            tx,
            { ...ticket, version: commentVersion },
            {
              type: 'TICKET_COMMENT_ADDED',
              commentId: comment.id,
              visibility: comment.visibility,
              authorMemberId: actor.membershipId,
            },
            at,
          );
        }
        if (index === 3) {
          const event = await tx.slaEvent.findUniqueOrThrow({
            where: {
              organizationId_ticketId_type: {
                organizationId,
                ticketId: id,
                type: 'RESOLUTION',
              },
            },
          });
          const at = new Date(event.dueAt.getTime() + 60000);
          await tx.slaEvent.update({
            where: { id: event.id },
            data: { breachedAt: at },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              action: 'SLA_RESOLUTION_BREACHED',
              entityType: 'SlaEvent',
              entityId: event.id,
              createdAt: at,
              metadata: { ticketId: id, type: event.type },
            },
          });
          const recipients = await tx.organizationMember.findMany({
            where: {
              organizationId,
              user: { isActive: true },
              OR: [
                { role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
                { id: ticket.assignedMemberId! },
              ],
            },
            select: { id: true },
          });
          await createNotifications(
            tx,
            recipients.map((recipient) => ({
              id: demoId(`breach:${event.id}:${recipient.id}`),
              organizationId,
              recipientMemberId: recipient.id,
              type: 'SLA_RESOLUTION_BREACHED',
              title: 'Çözüm SLA Süresi Aşıldı',
              message: `PD-${String(ticket.ticketNumber).padStart(6, '0')} numaralı talebin çözüm süresi aşıldı.`,
              entityType: 'Ticket',
              entityId: id,
              createdAt: at,
            })),
          );
        }
        createdTickets++;
      }
      for (const [key, role, index, type, title, message, read] of [
        [
          'assignment',
          'AGENT',
          3,
          'TICKET_ASSIGNED',
          'Yeni talep atandı',
          'Yeni kullanıcı erişim talebi size ve Customer Support ekibine atandı.',
          false,
        ],
        [
          'urgent',
          'MANAGER',
          1,
          'SYSTEM',
          'Acil talep açıldı',
          'Yönetici paneli erişim sorunu inceleme bekliyor.',
          true,
        ],
      ] as const) {
        const id = demoId(`notification:${key}`);
        if (!(await tx.notification.findUnique({ where: { id } })))
          await createNotifications(tx, [
            {
              id,
              organizationId,
              recipientMemberId: actors[role].membershipId,
              type,
              title,
              message,
              entityType: 'Ticket',
              entityId: demoId(`ticket:${index}`),
              createdAt: anchor,
              readAt: read ? anchor : null,
            },
          ]);
      }
      await tx.auditLog.upsert({
        where: { id: demoId('manifest:v1') },
        update: {},
        create: {
          id: demoId('manifest:v1'),
          organizationId,
          actorMemberId: actors.OWNER.membershipId,
          action: 'DEMO_SEEDED',
          entityType: 'Organization',
          entityId: organizationId,
          metadata: { version: 1, anchor: anchor.toISOString() },
        },
      });
      return { organizationId, createdTickets };
    },
    { timeout: 30000, maxWait: 10000 },
  );
}
