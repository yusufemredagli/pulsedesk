import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { DomainTransaction } from './domain-transaction.service';
@Module({
  imports: [DatabaseModule],
  providers: [DomainTransaction],
  exports: [DomainTransaction],
})
export class DomainModule {}
