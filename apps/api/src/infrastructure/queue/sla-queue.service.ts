import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Clock } from '../../common/clock.module';
import { RedisService } from '../redis/redis.service';
import type {
  OutboxEventType,
  SlaEventType,
} from '../../generated/prisma/client';
export interface SlaJobData {
  slaEventId: string;
}
export const SLA_QUEUE = 'sla';
export const SLA_JOBS = {
  FIRST_RESPONSE: 'sla:first-response:deadline',
  RESOLUTION: 'sla:resolution:deadline',
  COMPLETION: 'sla:completion:reconcile',
} as const;
export function jobId(eventId: string, type: OutboxEventType): string {
  return `${type === 'SLA_EVENT_SCHEDULED' ? 'sla-event' : 'sla-completion'}-${eventId}`;
}
@Injectable()
export class SlaQueue implements OnApplicationShutdown {
  private producer?: Queue<SlaJobData>;
  private degraded = false;
  private readonly logger = new Logger(SlaQueue.name);
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  get queue(): Queue<SlaJobData> {
    if (this.redis.client.status !== 'ready')
      throw new Error('SLA queue unavailable');
    if (!this.producer) {
      this.producer = new Queue<SlaJobData>(SLA_QUEUE, {
        connection: this.redis.client,
        prefix: this.config.getOrThrow<string>('SLA_QUEUE_PREFIX'),
        streams: { events: { maxLen: 5000 } },
        defaultJobOptions: {
          attempts: 7,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        },
      });
      this.producer.on('error', () => {
        if (!this.degraded)
          this.logger.warn('SLA queue connection unavailable');
        this.degraded = true;
      });
    }
    return this.producer;
  }
  async schedule(
    event: { id: string; type: SlaEventType; dueAt: Date },
    type: OutboxEventType,
  ): Promise<void> {
    const queue = this.queue;
    const name =
      type === 'SLA_EVENT_COMPLETED'
        ? SLA_JOBS.COMPLETION
        : SLA_JOBS[event.type];
    try {
      await queue.add(
        name,
        { slaEventId: event.id },
        {
          jobId: jobId(event.id, type),
          delay:
            type === 'SLA_EVENT_COMPLETED'
              ? 0
              : Math.max(0, event.dueAt.getTime() - this.clock.now().getTime()),
        },
      );
      this.degraded = false;
    } catch {
      this.producer = undefined;
      await queue.close();
      throw new Error('SLA queue delivery unavailable');
    }
  }
  async onApplicationShutdown(): Promise<void> {
    await this.producer?.close();
  }
}
