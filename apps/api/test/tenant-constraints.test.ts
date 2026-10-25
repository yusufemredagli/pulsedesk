import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'PostgreSQL enforces tenant boundaries, uniqueness, checks, and history retention',
  {
    skip:
      !databaseUrl &&
      'Set TEST_DATABASE_URL to an explicitly selected migrated test database',
  },
  async (t) => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    const rollback = new Error('rollback test fixtures');
    try {
      await assert.rejects(
        client.$transaction(
          async (tx) => {
            const suffix = randomUUID();
            const orgA = await tx.organization.create({
              data: { name: 'A', slug: `test-a-${suffix}` },
            });
            const orgB = await tx.organization.create({
              data: { name: 'B', slug: `test-b-${suffix}` },
            });
            const user = await tx.user.create({
              data: {
                name: 'Fixture',
                email: `${suffix}@example.invalid`,
                passwordHash: 'test-only-not-a-password-hash',
              },
            });
            const memberA = await tx.organizationMember.create({
              data: { organizationId: orgA.id, userId: user.id, role: 'OWNER' },
            });
            const memberB = await tx.organizationMember.create({
              data: { organizationId: orgB.id, userId: user.id, role: 'AGENT' },
            });
            const teamA = await tx.team.create({
              data: { organizationId: orgA.id, name: 'Support' },
            });
            const teamB = await tx.team.create({
              data: { organizationId: orgB.id, name: 'Support' },
            });
            const customerA = await tx.customer.create({
              data: { organizationId: orgA.id, name: 'Customer A' },
            });
            const customerB = await tx.customer.create({
              data: { organizationId: orgB.id, name: 'Customer B' },
            });
            const ticketData = {
              organizationId: orgA.id,
              customerId: customerA.id,
              ticketNumber: 1,
              subject: 'Fixture',
              description: 'Constraint checks',
            };
            const ticket = await tx.ticket.create({
              data: {
                ...ticketData,
                assignedMemberId: memberA.id,
                assignedTeamId: teamA.id,
              },
            });
            await tx.ticket.create({
              data: {
                ...ticketData,
                organizationId: orgB.id,
                customerId: customerB.id,
              },
            });
            const policyData = {
              organizationId: orgA.id,
              name: 'Standard',
              priority: 'MEDIUM' as const,
              firstResponseMinutes: 30,
              resolutionMinutes: 120,
            };
            const policy = await tx.slaPolicy.create({ data: policyData });
            const foreignPolicy = await tx.slaPolicy.create({
              data: { ...policyData, organizationId: orgB.id },
            });
            await tx.slaPolicy.create({
              data: { ...policyData, isActive: false },
            });
            await tx.teamMember.create({
              data: {
                organizationId: orgA.id,
                teamId: teamA.id,
                memberId: memberA.id,
              },
            });
            await tx.ticketAssignment.create({
              data: {
                organizationId: orgA.id,
                ticketId: ticket.id,
                assignedByMemberId: memberA.id,
              },
            });
            const eventData = {
              organizationId: orgA.id,
              ticketId: ticket.id,
              policyId: policy.id,
              type: 'FIRST_RESPONSE' as const,
              dueAt: new Date(Date.now() + 60000),
            };
            await tx.slaEvent.create({ data: eventData });
            await tx.auditLog.create({
              data: {
                organizationId: orgA.id,
                actorMemberId: memberA.id,
                action: 'fixture.created',
                entityType: 'Ticket',
                entityId: ticket.id,
              },
            });

            async function rejects(
              name: string,
              operation: () => Promise<unknown>,
              code: string | RegExp,
            ) {
              await t.test(name, async () => {
                await tx.$executeRaw`SAVEPOINT constraint_check`;
                try {
                  await assert.rejects(operation, (error: unknown) =>
                    code instanceof RegExp
                      ? error instanceof Error && code.test(error.message)
                      : error instanceof Prisma.PrismaClientKnownRequestError &&
                        error.code === code,
                  );
                } finally {
                  await tx.$executeRaw`ROLLBACK TO SAVEPOINT constraint_check`;
                  await tx.$executeRaw`RELEASE SAVEPOINT constraint_check`;
                }
              });
            }
            await rejects(
              'membership is unique within organization',
              () =>
                tx.organizationMember.create({
                  data: { organizationId: orgA.id, userId: user.id },
                }),
              'P2002',
            );
            await rejects(
              'team name is unique within organization',
              () =>
                tx.team.create({
                  data: { organizationId: orgA.id, name: 'Support' },
                }),
              'P2002',
            );
            await rejects(
              'team membership is unique',
              () =>
                tx.teamMember.create({
                  data: {
                    organizationId: orgA.id,
                    teamId: teamA.id,
                    memberId: memberA.id,
                  },
                }),
              'P2002',
            );
            await rejects(
              'team member must share organization',
              () =>
                tx.teamMember.create({
                  data: {
                    organizationId: orgA.id,
                    teamId: teamA.id,
                    memberId: memberB.id,
                  },
                }),
              'P2003',
            );
            await rejects(
              'team must share organization',
              () =>
                tx.teamMember.create({
                  data: {
                    organizationId: orgA.id,
                    teamId: teamB.id,
                    memberId: memberA.id,
                  },
                }),
              'P2003',
            );
            await rejects(
              'ticket number is unique within organization',
              () => tx.ticket.create({ data: ticketData }),
              'P2002',
            );
            await rejects(
              'customer must share ticket organization',
              () =>
                tx.ticket.create({
                  data: {
                    ...ticketData,
                    ticketNumber: 2,
                    customerId: customerB.id,
                  },
                }),
              'P2003',
            );
            await rejects(
              'assigned member must share ticket organization',
              () =>
                tx.ticket.update({
                  where: { id: ticket.id },
                  data: { assignedMemberId: memberB.id },
                }),
              'P2003',
            );
            await rejects(
              'assigned team must share ticket organization',
              () =>
                tx.ticket.update({
                  where: { id: ticket.id },
                  data: { assignedTeamId: teamB.id },
                }),
              'P2003',
            );
            const assignment = {
              organizationId: orgA.id,
              ticketId: ticket.id,
              assignedByMemberId: memberA.id,
            };
            await rejects(
              'assignment actor must share organization',
              () =>
                tx.ticketAssignment.create({
                  data: { ...assignment, assignedByMemberId: memberB.id },
                }),
              'P2003',
            );
            await rejects(
              'assignment recipient must share organization',
              () =>
                tx.ticketAssignment.create({
                  data: { ...assignment, assignedMemberId: memberB.id },
                }),
              'P2003',
            );
            await rejects(
              'assignment team must share organization',
              () =>
                tx.ticketAssignment.create({
                  data: { ...assignment, assignedTeamId: teamB.id },
                }),
              'P2003',
            );
            await rejects(
              'comment author must share organization',
              () =>
                tx.ticketComment.create({
                  data: {
                    organizationId: orgA.id,
                    ticketId: ticket.id,
                    authorMemberId: memberB.id,
                    body: 'Invalid',
                  },
                }),
              'P2003',
            );
            await rejects(
              'child ticket must share organization',
              () =>
                tx.ticketComment.create({
                  data: {
                    organizationId: orgB.id,
                    ticketId: ticket.id,
                    authorMemberId: memberB.id,
                    body: 'Invalid',
                  },
                }),
              'P2003',
            );
            await rejects(
              'status actor must share organization',
              () =>
                tx.ticketStatusHistory.create({
                  data: {
                    organizationId: orgA.id,
                    ticketId: ticket.id,
                    changedByMemberId: memberB.id,
                    toStatus: 'TRIAGED',
                  },
                }),
              'P2003',
            );
            await rejects(
              'SLA policy must share organization',
              () =>
                tx.slaEvent.create({
                  data: {
                    ...eventData,
                    type: 'RESOLUTION',
                    policyId: foreignPolicy.id,
                  },
                }),
              'P2003',
            );
            await rejects(
              'one SLA event per ticket and type',
              () => tx.slaEvent.create({ data: eventData }),
              'P2002',
            );
            await rejects(
              'notification recipient must share organization',
              () =>
                tx.notification.create({
                  data: {
                    organizationId: orgA.id,
                    recipientMemberId: memberB.id,
                    type: 'SYSTEM',
                    title: 'Invalid',
                    message: 'Invalid',
                  },
                }),
              'P2003',
            );
            await rejects(
              'audit actor must share organization',
              () =>
                tx.auditLog.create({
                  data: {
                    organizationId: orgA.id,
                    actorMemberId: memberB.id,
                    action: 'invalid',
                    entityType: 'Ticket',
                    entityId: ticket.id,
                  },
                }),
              'P2003',
            );
            await rejects(
              'one active SLA policy per organization and priority',
              () => tx.slaPolicy.create({ data: policyData }),
              'P2002',
            );
            await rejects(
              'SLA durations must be positive',
              () =>
                tx.slaPolicy.create({
                  data: {
                    ...policyData,
                    isActive: false,
                    firstResponseMinutes: 0,
                  },
                }),
              /SlaPolicy_positive_durations/,
            );
            await rejects(
              'ticket number must be positive',
              () =>
                tx.ticket.create({ data: { ...ticketData, ticketNumber: 0 } }),
              /Ticket_positive_number/,
            );
            await rejects(
              'ticket history prevents ticket deletion',
              () => tx.ticket.delete({ where: { id: ticket.id } }),
              'P2003',
            );
            await rejects(
              'audit references prevent member deletion',
              () => tx.organizationMember.delete({ where: { id: memberA.id } }),
              'P2003',
            );
            await rejects(
              'SLA events prevent policy deletion',
              () => tx.slaPolicy.delete({ where: { id: policy.id } }),
              'P2003',
            );
            throw rollback;
          },
          { timeout: 30000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await client.$disconnect();
    }
  },
);
