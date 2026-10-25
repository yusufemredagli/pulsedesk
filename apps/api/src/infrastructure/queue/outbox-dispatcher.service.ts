import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SlaQueue } from './sla-queue.service';
import { Clock } from '../../common/clock.module';
import type { OutboxEvent } from '../../generated/prisma/client';
export function retryDelay(attempt: number): number {
  return Math.min(300000, 1000 * 2 ** Math.min(attempt - 1, 9));
}
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(SlaQueue) private readonly queue: SlaQueue,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async dispatchBatch(limit = 25): Promise<number> {
    let dispatched = 0;
    for (let index = 0; index < Math.min(limit, 25); index++) {
      const claimed = await this.db.$transaction(
        async (tx) => {
          const now = this.clock.now();
          const rows = await tx.$queryRaw<
            OutboxEvent[]
          >`SELECT * FROM "OutboxEvent" WHERE "processedAt" IS NULL AND "nextAttemptAt"<=${now} ORDER BY "nextAttemptAt","createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const row = rows[0];
          if (!row) return false;
          const event = await tx.slaEvent.findFirst({
            where: { id: row.slaEventId, organizationId: row.organizationId },
          });
          if (!event) throw new Error('Outbox SLA relation missing');
          try {
            await this.queue.schedule(event, row.type);
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                processedAt: now,
                attempts: { increment: 1 },
                lastError: null,
              },
            });
          } catch {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError: 'QUEUE_DELIVERY_FAILED',
                nextAttemptAt: new Date(
                  now.getTime() + retryDelay(row.attempts + 1),
                ),
              },
            });
            this.logger.warn('SLA outbox delivery deferred; message retained');
          }
          return true;
        },
        { timeout: 6000, maxWait: 2000 },
      );
      if (!claimed) break;
      dispatched++;
    }
    return dispatched;
  }
  async cleanupProcessed(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - 7 * 86400000);
    await this.db
      .$executeRaw`DELETE FROM "OutboxEvent" WHERE "id" IN (SELECT o."id" FROM "OutboxEvent" o JOIN "SlaEvent" s ON s."id"=o."slaEventId" AND s."organizationId"=o."organizationId" JOIN "Ticket" t ON t."id"=s."ticketId" AND t."organizationId"=s."organizationId" WHERE o."processedAt"<${cutoff} AND (s."breachedAt" IS NOT NULL OR (s."completedAt" IS NOT NULL AND s."completedAt"<=s."dueAt") OR t."status"='CANCELLED') ORDER BY o."processedAt" LIMIT 1000 FOR UPDATE OF o SKIP LOCKED)`;
  }
}
