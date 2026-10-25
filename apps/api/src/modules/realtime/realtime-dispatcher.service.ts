import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Clock } from '../../common/clock.module';
import type { OutboxEvent } from '../../generated/prisma/client';
import { retryDelay } from '../../infrastructure/queue/outbox-dispatcher.service';
import { RealtimeEmitter } from './realtime-emitter.service';
import { InvalidRealtimeEvent, mapDomainEvent } from './realtime-domain-events';
@Injectable()
export class RealtimeDispatcher {
  private readonly logger = new Logger(RealtimeDispatcher.name);
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async dispatchBatch(limit = 25): Promise<number> {
    let claimed = 0;
    for (let i = 0; i < Math.min(limit, 25); i++) {
      const found = await this.db.$transaction(
        async (tx) => {
          const now = this.clock.now();
          const rows = await tx.$queryRaw<
            OutboxEvent[]
          >`SELECT * FROM "OutboxEvent" WHERE "type" IN ('TICKET_CREATED','TICKET_UPDATED','TICKET_ASSIGNED','TICKET_STATUS_CHANGED','TICKET_COMMENT_ADDED','NOTIFICATION_CREATED') AND "processedAt" IS NULL AND "failedAt" IS NULL AND "nextAttemptAt"<=${now} ORDER BY "nextAttemptAt","createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const row = rows[0];
          if (!row) return false;
          try {
            const notification = row.notificationId
              ? await tx.notification.findFirst({
                  where: {
                    organizationId: row.organizationId,
                    id: row.notificationId,
                  },
                })
              : undefined;
            const event = mapDomainEvent(row, notification ?? undefined);
            await this.emitter.deliver(event, notification?.recipientMemberId);
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                processedAt: now,
                attempts: { increment: 1 },
                lastError: null,
              },
            });
          } catch (error) {
            const permanent = error instanceof InvalidRealtimeEvent;
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                failedAt: permanent ? now : null,
                lastError: permanent
                  ? 'INVALID_REALTIME_EVENT'
                  : 'REALTIME_DELIVERY_FAILED',
                nextAttemptAt: new Date(
                  now.getTime() + retryDelay(row.attempts + 1),
                ),
              },
            });
            this.logger.warn(
              `eventId=${row.id} type=${row.type} destination=${row.notificationId ? 'member' : 'organization'} error=${permanent ? 'INVALID_REALTIME_EVENT' : 'REALTIME_DELIVERY_FAILED'}`,
            );
          }
          return true;
        },
        { timeout: 15000, maxWait: 2000 },
      );
      if (!found) break;
      claimed++;
    }
    return claimed;
  }
  async cleanupProcessed(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - 7 * 86400000);
    await this.db
      .$executeRaw`DELETE FROM "OutboxEvent" WHERE "id" IN (SELECT "id" FROM "OutboxEvent" WHERE "type" IN ('TICKET_CREATED','TICKET_UPDATED','TICKET_ASSIGNED','TICKET_STATUS_CHANGED','TICKET_COMMENT_ADDED','NOTIFICATION_CREATED') AND "processedAt"<${cutoff} ORDER BY "processedAt" LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
  }
}
