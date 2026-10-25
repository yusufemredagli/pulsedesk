import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeDispatcher } from './realtime-dispatcher.service';
import { RealtimeEmitter } from './realtime-emitter.service';
@Injectable()
export class RealtimeDispatchRuntime
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private stopping = false;
  private lastError = 0;
  private readonly logger = new Logger(RealtimeDispatchRuntime.name);
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RealtimeDispatcher) private readonly dispatcher: RealtimeDispatcher,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
  ) {}
  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => this.tick(),
      this.config.getOrThrow<number>('OUTBOX_POLL_INTERVAL_MS'),
    );
    this.tick();
  }
  private tick(): void {
    if (this.stopping || this.pending) return;
    this.pending = (async () => {
      await this.dispatcher.dispatchBatch();
      await this.dispatcher.cleanupProcessed();
    })()
      .catch(() => {
        if (Date.now() - this.lastError > 10000) {
          this.logger.warn(
            'Realtime outbox dispatch unavailable; pending rows preserved',
          );
          this.lastError = Date.now();
        }
      })
      .finally(() => {
        this.pending = undefined;
      });
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    this.emitter.detach();
  }
}
