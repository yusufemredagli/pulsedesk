import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketServer,
  WebSocketGateway,
} from '@nestjs/websockets';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeRoomService } from './realtime-room.service';
import type { RealtimeSocket, RealtimeNamespace } from './realtime-context';
import {
  failure,
  REALTIME,
  type JoinResult,
  type LeaveResult,
  type RealtimeFailure,
} from './realtime-events';
@WebSocketGateway({
  namespace: REALTIME.NAMESPACE,
  transports: ['websocket'],
  maxHttpBufferSize: 8192,
  // Fail closed if a custom application bootstrap omits configureRealtime().
  allowRequest: (_request, callback) => callback(null, false),
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: RealtimeNamespace;
  private readonly logger = new Logger(RealtimeGateway.name);
  constructor(
    @Inject(RealtimeAuthService) private readonly auth: RealtimeAuthService,
    @Inject(RealtimeRoomService) private readonly rooms: RealtimeRoomService,
  ) {}
  afterInit(server: RealtimeNamespace): void {
    server.use((socket: RealtimeSocket, next) => {
      void this.auth
        .authenticate(socket)
        .then(() => {
          socket.handshake.auth = {};
          next();
        })
        .catch((error: unknown) => {
          socket.handshake.auth = {};
          this.rooms.cleanup(socket);
          const result = this.error(error);
          next(Object.assign(new Error(result.message), { data: result }));
        })
        .finally(() => {
          socket.handshake.auth = {};
        });
    });
    this.logger.log('Authenticated realtime gateway initialized');
  }
  handleConnection(socket: RealtimeSocket): void {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect(true);
      return;
    }
    socket.data.expiryTimer = setTimeout(
      () => {
        socket.emit(REALTIME.ERROR, failure('UNAUTHENTICATED'));
        socket.disconnect(true);
      },
      Math.max(0, identity.expiresAt - Date.now()),
    );
    socket.data.expiryTimer.unref();
    socket.emit(REALTIME.READY, { ok: true });
  }
  handleDisconnect(socket: RealtimeSocket): void {
    this.rooms.cleanup(socket);
  }
  @SubscribeMessage(REALTIME.JOIN)
  async join(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<JoinResult> {
    if (socket.data.busy) return failure('BUSY');
    socket.data.busy = true;
    try {
      const previous = await this.rooms.clear(socket);
      if (previous)
        socket.emit(REALTIME.LEFT, { ok: true, organizationId: previous });
      const tenant = await this.rooms.join(socket, payload);
      const result = {
        ok: true as const,
        organizationId: tenant.organizationId,
        membershipId: tenant.membershipId,
        role: tenant.role,
      };
      socket.emit(REALTIME.JOINED, result);
      return result;
    } catch (error) {
      return this.reject(socket, error);
    } finally {
      if (socket.connected) delete socket.data.busy;
    }
  }
  @SubscribeMessage(REALTIME.LEAVE)
  async leave(@ConnectedSocket() socket: RealtimeSocket): Promise<LeaveResult> {
    if (socket.data.busy) return failure('BUSY');
    socket.data.busy = true;
    try {
      const organizationId = await this.rooms.clear(socket);
      await this.auth.session(socket);
      const result = { ok: true as const, organizationId };
      socket.emit(REALTIME.LEFT, result);
      return result;
    } catch (error) {
      return this.reject(socket, error);
    } finally {
      if (socket.connected) delete socket.data.busy;
    }
  }
  private error(error: unknown): RealtimeFailure {
    if (error instanceof UnauthorizedException)
      return failure('UNAUTHENTICATED');
    if (error instanceof ForbiddenException) return failure('ACCESS_DENIED');
    if (error instanceof BadRequestException) return failure('INVALID_REQUEST');
    this.logger.error('Realtime operation failed');
    return failure('UNAVAILABLE');
  }
  private async reject(
    socket: RealtimeSocket,
    error: unknown,
  ): Promise<RealtimeFailure> {
    await this.rooms.clear(socket);
    const result = this.error(error);
    // Keep the transport until the ack is sent. Expiry or disconnect cleans it up;
    // no organization room remains after any failed revalidation.
    return result;
  }
}
