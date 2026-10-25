import { Inject, Injectable } from '@nestjs/common';
import type {
  Prisma,
  SlaEventType,
  Ticket,
} from '../../generated/prisma/client';
import { Clock } from '../../common/clock.module';
import { audit } from '../../common/domain-transaction.service';
import type { TenantContext } from '../auth/types/request-context';
export function deadline(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60000);
}
@Injectable()
export class SlaService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}
  async create(tx: Prisma.TransactionClient, ticket: Ticket): Promise<void> {
    const policy = await tx.slaPolicy.findFirst({
      where: {
        organizationId: ticket.organizationId,
        priority: ticket.priority,
        isActive: true,
      },
    });
    if (!policy) return;
    for (const type of ['FIRST_RESPONSE', 'RESOLUTION'] as const) {
      const event = await tx.slaEvent.create({
        data: {
          organizationId: ticket.organizationId,
          ticketId: ticket.id,
          policyId: policy.id,
          type,
          dueAt: deadline(
            ticket.createdAt,
            type === 'FIRST_RESPONSE'
              ? policy.firstResponseMinutes
              : policy.resolutionMinutes,
          ),
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: ticket.organizationId,
          slaEventId: event.id,
          type: 'SLA_EVENT_SCHEDULED',
        },
      });
    }
  }
  async complete(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    ticketId: string,
    type: SlaEventType,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "SlaEvent" WHERE "organizationId"=${context.organizationId}::uuid AND "ticketId"=${ticketId}::uuid AND "type"=${type}::"SlaEventType" FOR UPDATE`;
    const at = this.clock.now();
    const event = await tx.slaEvent.findFirst({
      where: { organizationId: context.organizationId, ticketId, type },
    });
    if (!event) return;
    const updated = await tx.slaEvent.updateMany({
      where: {
        id: event.id,
        organizationId: context.organizationId,
        completedAt: null,
      },
      data: { completedAt: at },
    });
    if (!updated.count) return;
    await audit(
      tx,
      context,
      type === 'FIRST_RESPONSE'
        ? 'SLA_FIRST_RESPONSE_COMPLETED'
        : 'SLA_RESOLUTION_COMPLETED',
      'SlaEvent',
      event.id,
      { ticketId },
    );
    if (at > event.dueAt)
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          slaEventId: event.id,
          type: 'SLA_EVENT_COMPLETED',
        },
      });
  }
}
