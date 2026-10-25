import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// Prisma's PostgreSQL adapter normalizes timestamptz text assuming UTC.
// Set every pooled connection's session timezone, independently of server defaults.
export function utcConnectionString(value: string): string {
  const url = new URL(value);
  const options = url.searchParams.get('options');
  url.searchParams.set(
    'options',
    `${options ? `${options} ` : ''}-c timezone=UTC`,
  );
  return url.toString();
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    if (!connectionString.trim()) {
      throw new Error('DATABASE_URL is required for database initialization');
    }
    super({
      adapter: new PrismaPg({
        connectionString: utcConnectionString(connectionString),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
