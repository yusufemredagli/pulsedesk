import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../../common/domain.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
@Module({
  imports: [AuthModule, DomainModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
