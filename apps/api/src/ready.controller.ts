import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from './infrastructure/database/prisma.service';
import { RedisService } from './infrastructure/redis/redis.service';
@Controller('ready')
export class ReadyController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  @Get()
  async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      await this.redis.ping();
      return { status: 'ok', service: 'pulsedesk-api' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
