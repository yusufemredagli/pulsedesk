import { SettingsModule } from './modules/settings/settings.module';
import { OperationsModule } from './modules/operations/operations.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ReadyController } from './ready.controller';
import { SlaModule } from './modules/sla/sla.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TeamsModule } from './modules/teams/teams.module';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { SafeExceptionFilter } from './common/safe-exception.filter';
import { validationFor } from './common/validation';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { validateEnvironment } from './config/environment';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    SettingsModule,
    OperationsModule,
    AuthModule,
    RedisModule,
    SlaModule,
    NotificationsModule,
    TicketsModule,
    CustomersModule,
    TeamsModule,
    RealtimeModule,
  ],
  controllers: [HealthController, ReadyController],
  providers: [
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
    { provide: APP_PIPE, useFactory: () => validationFor() },
  ],
})
export class AppModule {}
