import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';
export function redisOptions(url: string, worker = false): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 2000,
    ...(!worker ? { commandTimeout: 2000 } : {}),
    retryStrategy: (attempt: number) => Math.min(attempt * 1000, 10000),
  };
}
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  readonly client: Redis;
  private degraded = false;
  private readonly logger = new Logger(RedisService.name);
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.client = new Redis({
      ...redisOptions(config.getOrThrow<string>('REDIS_URL')),
      lazyConnect: true,
    });
    this.client.on('error', () => this.unavailable());
    this.client.on('ready', () => {
      if (this.degraded) this.logger.log('Redis connection recovered');
      this.degraded = false;
    });
  }
  onModuleInit(): void {
    void this.client.connect().catch(() => this.unavailable());
  }
  private unavailable() {
    if (!this.degraded)
      this.logger.warn('Redis unavailable; queue readiness degraded');
    this.degraded = true;
  }
  async ping(): Promise<void> {
    if (this.client.status !== 'ready') throw new Error('Redis unavailable');
    await this.client.ping();
  }
  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
