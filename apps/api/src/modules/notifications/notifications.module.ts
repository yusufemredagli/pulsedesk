import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../../common/domain.module';
import { ClockModule } from '../../common/clock.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
@Module({
  imports: [AuthModule, DomainModule, ClockModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
