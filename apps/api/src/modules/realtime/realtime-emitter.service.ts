import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { accessibleTickets } from '../tickets/policies/ticket.policy';
import { RealtimeRoomService } from './realtime-room.service';
import type { RealtimeNamespace, RealtimeSocket } from './realtime-context';
import { DOMAIN_EVENTS, type DomainEmission } from './realtime-domain-events';
@Injectable()
export class RealtimeEmitter {
  private server?: RealtimeNamespace;
  constructor(
    @Inject(RealtimeRoomService) private readonly rooms: RealtimeRoomService,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  attach(server: RealtimeNamespace): void {
    this.server = server;
  }
  detach(): void {
    this.server = undefined;
  }
  async deliver(event: DomainEmission, memberId?: string): Promise<void> {
    const server = this.server;
    if (!server) throw new Error('Realtime transport unavailable');
    const organizationId = event.payload.organizationId;
    const room = memberId ? `member:${memberId}` : `org:${organizationId}`;
    // Snapshot candidates only. Revalidate each immediately before sending; never
    // authorize a bulk room emit using a historic room membership snapshot.
    for (const id of [...(server.adapter.rooms.get(room) ?? [])]) {
      const socket = server.sockets.get(id);
      if (!socket || socket.data.busy) continue;
      const revision = socket.data.tenantRevision;
      let tenant;
      try {
        tenant = await this.rooms.revalidate(socket);
      } catch (error) {
        if (error instanceof UnauthorizedException) {
          socket.disconnect(true);
          continue;
        }
        if (error instanceof ForbiddenException) continue;
        throw error;
      }
      if (
        tenant.organizationId !== organizationId ||
        (memberId && tenant.membershipId !== memberId)
      )
        continue;
      if (
        'ticketId' in event.payload &&
        !(await this.db.ticket.findFirst({
          where: { ...accessibleTickets(tenant), id: event.payload.ticketId },
          select: { id: true },
        }))
      )
        continue;
      // A selection may have changed while the database read was in flight.
      if (
        !socket.connected ||
        socket.data.busy ||
        socket.data.tenantRevision !== revision ||
        socket.data.tenant?.organizationId !== organizationId
      )
        continue;
      this.emit(socket, event);
    }
  }
  private emit(socket: RealtimeSocket, event: DomainEmission): void {
    switch (event.name) {
      case DOMAIN_EVENTS.CREATED:
        socket.emit(event.name, event.payload);
        break;
      case DOMAIN_EVENTS.UPDATED:
        socket.emit(event.name, event.payload);
        break;
      case DOMAIN_EVENTS.ASSIGNED:
        socket.emit(event.name, event.payload);
        break;
      case DOMAIN_EVENTS.STATUS:
        socket.emit(event.name, event.payload);
        break;
      case DOMAIN_EVENTS.COMMENT:
        socket.emit(event.name, event.payload);
        break;
      case DOMAIN_EVENTS.NOTIFICATION:
        socket.emit(event.name, event.payload);
        break;
    }
  }
}
