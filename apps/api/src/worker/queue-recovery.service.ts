import { Inject, Injectable } from '@nestjs/common';
import type { OutboxEvent } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  SlaQueue,
  SLA_JOBS,
  jobId,
} from '../infrastructure/queue/sla-queue.service';
import { OutboxDispatcher } from '../infrastructure/queue/outbox-dispatcher.service';
import { Clock } from '../common/clock.module';
import { validJobData } from './worker-runtime.service';
@Injectable()
export class QueueRecovery {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(SlaQueue) private readonly queue: SlaQueue,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async retryFailed() {
    const jobs = await this.queue.queue.getFailed(0, 99);
    let retried = 0;
    for (const job of jobs) {
      if (
        !validJobData(job.data) ||
        !Object.values(SLA_JOBS).some((name) => name === job.name)
      )
        continue;
      const event = await this.db.slaEvent.findUnique({
        where: { id: job.data.slaEventId },
      });
      if (
        !event ||
        (job.name !== SLA_JOBS.COMPLETION && job.name !== SLA_JOBS[event.type])
      )
        continue;
      await job.retry('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      retried++;
    }
    return { examined: jobs.length, retried };
  }
  async replay(after: string | null = null) {
    const queue = this.queue.queue;
    const rows = await this.db.$queryRaw<
      OutboxEvent[]
    >`SELECT o.* FROM "OutboxEvent" o JOIN "SlaEvent" s ON s."id"=o."slaEventId" AND s."organizationId"=o."organizationId" JOIN "Ticket" t ON t."id"=s."ticketId" AND t."organizationId"=s."organizationId" WHERE (${after}::uuid IS NULL OR o."id">${after}::uuid) AND s."breachedAt" IS NULL AND t."status"<>'CANCELLED' AND ((o."type"='SLA_EVENT_SCHEDULED' AND s."completedAt" IS NULL) OR (o."type"='SLA_EVENT_COMPLETED' AND s."completedAt">s."dueAt")) ORDER BY o."id" LIMIT 100`;
    for (const row of rows) {
      const existing = await queue.getJob(jobId(row.slaEventId, row.type));
      if (existing && (await existing.getState()) === 'failed')
        await existing.remove();
      await this.db.outboxEvent.update({
        where: { id: row.id },
        data: {
          processedAt: null,
          nextAttemptAt: this.clock.now(),
          lastError: 'MANUAL_REPLAY',
        },
      });
    }
    for (let batch = 0; batch < 4; batch++)
      if (!(await this.dispatcher.dispatchBatch())) break;
    return { replayed: rows.length, nextCursor: rows.at(-1)?.id ?? null };
  }
}
