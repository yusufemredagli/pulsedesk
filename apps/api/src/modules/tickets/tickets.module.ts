import { SlaModule } from '../sla/sla.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../../common/domain.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
@Module({
  imports: [AuthModule, DomainModule, SlaModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
