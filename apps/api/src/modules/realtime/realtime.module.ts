import { ClockModule } from '../../common/clock.module';
import { RealtimeEmitter } from './realtime-emitter.service';
import { RealtimeDispatcher } from './realtime-dispatcher.service';
import { RealtimeDispatchRuntime } from './realtime-dispatch-runtime';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeRoomService } from './realtime-room.service';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule, ClockModule],
  providers: [
    RealtimeAuthService,
    RealtimeRoomService,
    RealtimeGateway,
    RealtimeEmitter,
    RealtimeDispatcher,
    RealtimeDispatchRuntime,
  ],
  exports: [RealtimeRoomService],
})
export class RealtimeModule {}
