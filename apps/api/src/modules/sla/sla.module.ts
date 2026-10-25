import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../../common/domain.module';
import { ClockModule } from '../../common/clock.module';
import { SlaService } from './sla.service';
import { SlaPolicyService } from './sla-policy.service';
import { SlaPolicyController } from './sla-policy.controller';
@Module({
  imports: [AuthModule, DomainModule, ClockModule],
  controllers: [SlaPolicyController],
  providers: [SlaService, SlaPolicyService],
  exports: [SlaService, ClockModule],
})
export class SlaModule {}
