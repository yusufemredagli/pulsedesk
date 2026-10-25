import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { isUUID } from 'class-validator';
import {
  redisOptions,
  RedisService,
} from '../infrastructure/redis/redis.service';
import {
  SLA_JOBS,
  SLA_QUEUE,
  type SlaJobData,
} from '../infrastructure/queue/sla-queue.service';
import { OutboxDispatcher } from '../infrastructure/queue/outbox-dispatcher.service';
import { SlaDeadlineService } from '../modules/sla/sla-deadline.service';
export function validJobData(data: unknown): data is SlaJobData {
  return (
    !!data &&
    typeof data === 'object' &&
    Object.keys(data).length === 1 &&
    Object.keys(data)[0] === 'slaEventId' &&
    'slaEventId' in data &&
    typeof data.slaEventId === 'string' &&
    isUUID(data.slaEventId)
  );
}
@Injectable()
export class WorkerRuntime implements OnApplicationBootstrap, OnModuleDestroy {
  worker?: Worker<SlaJobData>;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private stopping = false;
  private lastError = 0;
  private readonly logger = new Logger(WorkerRuntime.name);
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(SlaDeadlineService) private readonly deadlines: SlaDeadlineService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker<SlaJobData>(
      SLA_QUEUE,
      (job, token) => this.process(job, token),
      {
        connection: redisOptions(
          this.config.getOrThrow<string>('REDIS_URL'),
          true,
        ),
        prefix: this.config.getOrThrow<string>('SLA_QUEUE_PREFIX'),
        concurrency: 5,
        autorun: false,
      },
    );
    this.worker.on('error', () => this.error());
    this.worker.on('failed', (job, error) => {
      if (
        error instanceof UnrecoverableError ||
        (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      )
        this.logger.error(
          'SLA job reached terminal failure; retained for inspection and retry',
        );
    });
    void this.worker.run().catch(() => this.error());
    this.timer = setInterval(
      () => this.tick(),
      this.config.getOrThrow<number>('OUTBOX_POLL_INTERVAL_MS'),
    );
    this.tick();
    try {
      await this.redis.ping();
      this.logger.log('SLA worker started; PostgreSQL and Redis ready');
    } catch {
      this.logger.warn(
        'SLA worker started in degraded mode; Redis reconnecting',
      );
    }
  }
  async process(job: Job<SlaJobData>, token?: string): Promise<void> {
    if (!validJobData(job.data))
      throw new UnrecoverableError('Invalid SLA job payload');
    const completion = job.name === SLA_JOBS.COMPLETION;
    if (
      !completion &&
      job.name !== SLA_JOBS.FIRST_RESPONSE &&
      job.name !== SLA_JOBS.RESOLUTION
    )
      throw new UnrecoverableError('Unknown SLA job');
    const result = await this.deadlines.process(
      job.data.slaEventId,
      completion
        ? null
        : job.name === SLA_JOBS.FIRST_RESPONSE
          ? 'FIRST_RESPONSE'
          : 'RESOLUTION',
      completion,
    );
    if (result.state === 'early') {
      await job.moveToDelayed(result.dueAt.getTime(), token);
      throw new DelayedError();
    }
  }
  private tick(): void {
    if (this.stopping || this.pending) return;
    this.pending = (async () => {
      await this.dispatcher.dispatchBatch();
      await this.dispatcher.cleanupProcessed();
    })()
      .catch(() => this.error())
      .finally(() => {
        this.pending = undefined;
      });
  }
  private error(): void {
    if (Date.now() - this.lastError > 10000) {
      this.logger.warn(
        'SLA worker dependency unavailable; pending work preserved',
      );
      this.lastError = Date.now();
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.worker?.close();
  }
}
