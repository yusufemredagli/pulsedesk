import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateInfrastructure } from '../config/infrastructure';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { QueueModule } from '../infrastructure/queue/queue.module';
import { ClockModule } from '../common/clock.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateInfrastructure,
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    ClockModule,
  ],
  exports: [DatabaseModule, RedisModule, QueueModule, ClockModule],
})
export class WorkerInfrastructureModule {}
