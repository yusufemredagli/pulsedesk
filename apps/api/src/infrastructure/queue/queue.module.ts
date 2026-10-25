import { RedisModule } from '../redis/redis.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClockModule } from '../../common/clock.module';
import { SlaQueue } from './sla-queue.service';
@Module({
  imports: [ConfigModule, ClockModule, RedisModule],
  providers: [SlaQueue],
  exports: [SlaQueue],
})
export class QueueModule {}
