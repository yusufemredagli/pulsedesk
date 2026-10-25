import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../../common/domain.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
@Module({
  imports: [AuthModule, DomainModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
