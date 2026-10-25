import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeRoomService } from './realtime-room.service';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule],
  providers: [RealtimeAuthService, RealtimeRoomService, RealtimeGateway],
  exports: [RealtimeRoomService],
})
export class RealtimeModule {}
