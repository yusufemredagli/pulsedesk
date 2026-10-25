import { Module } from '@nestjs/common';
import { WorkerInfrastructureModule } from './worker-infrastructure.module';
import { SlaDeadlineService } from '../modules/sla/sla-deadline.service';
import { OutboxDispatcher } from '../infrastructure/queue/outbox-dispatcher.service';
import { WorkerRuntime } from './worker-runtime.service';
@Module({
  imports: [WorkerInfrastructureModule],
  providers: [SlaDeadlineService, OutboxDispatcher, WorkerRuntime],
})
export class WorkerModule {}
