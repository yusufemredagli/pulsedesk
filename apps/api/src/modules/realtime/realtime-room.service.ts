import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { RealtimeAuthService } from './realtime-auth.service';
import type { RealtimeSocket } from './realtime-context';
import type { TenantContext } from '../auth/types/request-context';
@Injectable()
export class RealtimeRoomService {
  constructor(
    @Inject(RealtimeAuthService) private readonly auth: RealtimeAuthService,
  ) {}
  private names(tenant: TenantContext): string[] {
    return [`org:${tenant.organizationId}`, `member:${tenant.membershipId}`];
  }
  async clear(socket: RealtimeSocket): Promise<string | null> {
    const previous = socket.data.tenant;
    if (socket.connected)
      socket.data.tenantRevision = (socket.data.tenantRevision ?? 0) + 1;
    else delete socket.data.tenantRevision;
    delete socket.data.tenant;
    if (previous)
      for (const name of this.names(previous)) await socket.leave(name);
    return previous?.organizationId ?? null;
  }
  async join(socket: RealtimeSocket, payload: unknown): Promise<TenantContext> {
    await this.clear(socket);
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !('organizationId' in payload) ||
      typeof payload.organizationId !== 'string' ||
      !isUUID(payload.organizationId)
    )
      throw new BadRequestException();
    const tenant = await this.auth.membership(socket, payload.organizationId);
    if (!socket.connected) throw new UnauthorizedException();
    socket.data.tenant = Object.freeze(tenant);
    try {
      await socket.join(this.names(tenant));
      if (!socket.connected) throw new UnauthorizedException();
      return tenant;
    } catch (error) {
      await this.clear(socket);
      throw error;
    }
  }
  // Future actions/emission paths must call this, rather than trusting cached roles.
  async revalidate(socket: RealtimeSocket): Promise<TenantContext> {
    const previous = socket.data.tenant;
    if (!previous || !socket.connected) throw new ForbiddenException();
    const revision = socket.data.tenantRevision;
    try {
      const current = await this.auth.membership(
        socket,
        previous.organizationId,
      );
      if (
        !socket.connected ||
        socket.data.tenantRevision !== revision ||
        socket.data.tenant?.organizationId !== previous.organizationId ||
        current.membershipId !== previous.membershipId
      )
        throw new ForbiddenException();
      socket.data.tenant = Object.freeze(current);
      return current;
    } catch (error) {
      if (socket.data.tenantRevision === revision) await this.clear(socket);
      throw error;
    }
  }
  cleanup(socket: RealtimeSocket): void {
    if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer);
    delete socket.data.expiryTimer;
    delete socket.data.identity;
    delete socket.data.tenant;
    delete socket.data.busy;
    delete socket.data.tenantRevision;
  }
}
