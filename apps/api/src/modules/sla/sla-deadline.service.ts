import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Clock } from '../../common/clock.module';
import type { SlaEventType } from '../../generated/prisma/client';
export type DeadlineResult =
  { state: 'noop' | 'breached' } | { state: 'early'; dueAt: Date };
@Injectable()
export class SlaDeadlineService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async process(
    id: string,
    expectedType: SlaEventType | null,
    completion = false,
  ): Promise<DeadlineResult> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "SlaEvent" WHERE "id"=${id}::uuid FOR UPDATE`;
        const event = await tx.slaEvent.findUnique({ where: { id } });
        if (!event) return { state: 'noop' };
        if (expectedType && expectedType !== event.type)
          throw new UnrecoverableError('Invalid SLA job type');
        if (event.breachedAt) return { state: 'noop' };
        const ticket = await tx.ticket.findFirst({
          where: { id: event.ticketId, organizationId: event.organizationId },
          select: {
            id: true,
            ticketNumber: true,
            status: true,
            assignedMemberId: true,
          },
        });
        if (!ticket || ticket.status === 'CANCELLED') return { state: 'noop' };
        if (completion) {
          if (!event.completedAt || event.completedAt <= event.dueAt)
            return { state: 'noop' };
        } else if (event.completedAt) return { state: 'noop' };
        const now = this.clock.now();
        if (event.dueAt > now) return { state: 'early', dueAt: event.dueAt };
        const changed = await tx.slaEvent.updateMany({
          where: {
            id: event.id,
            organizationId: event.organizationId,
            breachedAt: null,
            ...(!completion
              ? { completedAt: null }
              : { completedAt: { gt: event.dueAt } }),
          },
          data: { breachedAt: now },
        });
        if (!changed.count) return { state: 'noop' };
        const recipients = await tx.organizationMember.findMany({
          where: {
            organizationId: event.organizationId,
            user: { isActive: true },
            OR: [
              { role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
              ...(ticket.assignedMemberId
                ? [{ id: ticket.assignedMemberId }]
                : []),
            ],
          },
          select: { id: true },
        });
        const first = event.type === 'FIRST_RESPONSE';
        const title = first
          ? 'First response SLA breached'
          : 'Resolution SLA breached';
        const reference = `PD-${String(ticket.ticketNumber).padStart(6, '0')}`;
        if (recipients.length)
          await tx.notification.createMany({
            data: recipients.map((recipient) => ({
              organizationId: event.organizationId,
              recipientMemberId: recipient.id,
              type: first
                ? 'SLA_FIRST_RESPONSE_BREACHED'
                : 'SLA_RESOLUTION_BREACHED',
              title,
              message: `Ticket ${reference} exceeded its ${first ? 'first response' : 'resolution'} deadline.`,
              entityType: 'Ticket',
              entityId: ticket.id,
            })),
          });
        await tx.auditLog.create({
          data: {
            organizationId: event.organizationId,
            action: first
              ? 'SLA_FIRST_RESPONSE_BREACHED'
              : 'SLA_RESOLUTION_BREACHED',
            entityType: 'SlaEvent',
            entityId: event.id,
            metadata: { ticketId: ticket.id, type: event.type },
          },
        });
        return { state: 'breached' };
      },
      { timeout: 10000 },
    );
  }
}
