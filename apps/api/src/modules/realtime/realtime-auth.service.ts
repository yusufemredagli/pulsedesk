import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessTokenService } from '../auth/access-token.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { RealtimeSocket } from './realtime-context';
import type { TenantContext } from '../auth/types/request-context';
@Injectable()
export class RealtimeAuthService {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  async authenticate(socket: RealtimeSocket): Promise<void> {
    const auth: unknown = socket.handshake.auth;
    if (
      !auth ||
      typeof auth !== 'object' ||
      Array.isArray(auth) ||
      Object.keys(auth).length !== 1 ||
      !('token' in auth) ||
      typeof auth.token !== 'string'
    )
      throw new UnauthorizedException();
    const verified = await this.tokens.authenticate(auth.token);
    socket.data.identity = Object.freeze({
      userId: verified.userId,
      sessionId: verified.sessionId,
      expiresAt: verified.expiresAt,
    });
  }
  async membership(
    socket: RealtimeSocket,
    organizationId: string,
  ): Promise<TenantContext> {
    const identity = socket.data.identity;
    if (!identity) throw new UnauthorizedException();
    await this.tokens.revalidate(identity);
    const member = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: identity.userId },
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        role: true,
        user: { select: { isActive: true } },
      },
    });
    if (!member?.user.isActive) throw new ForbiddenException();
    return {
      userId: member.userId,
      organizationId: member.organizationId,
      membershipId: member.id,
      role: member.role,
    };
  }
  async session(socket: RealtimeSocket): Promise<void> {
    if (!socket.data.identity) throw new UnauthorizedException();
    await this.tokens.revalidate(socket.data.identity);
  }
}
