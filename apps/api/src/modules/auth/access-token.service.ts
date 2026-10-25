import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { publicUserSelect, type AuthContext } from './types/request-context';
export interface AccessIdentity {
  userId: string;
  sessionId: string;
  expiresAt: number;
}
@Injectable()
export class AccessTokenService {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  async authenticate(token: string): Promise<AuthContext & AccessIdentity> {
    if (!token || token.length > 8192) throw new UnauthorizedException();
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        algorithms: ['HS256'],
        issuer: 'pulsedesk-api',
        audience: 'pulsedesk-web',
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (
      typeof payload.sub !== 'string' ||
      !isUUID(payload.sub) ||
      typeof payload.sid !== 'string' ||
      !isUUID(payload.sid) ||
      !Number.isInteger(payload.exp) ||
      !Number.isInteger(payload.iat)
    )
      throw new UnauthorizedException();
    const identity = {
      userId: payload.sub,
      sessionId: payload.sid,
      expiresAt: Number(payload.exp) * 1000,
    };
    const auth = await this.revalidate(identity);
    return { ...identity, ...auth };
  }
  async revalidate(identity: AccessIdentity): Promise<AuthContext> {
    if (identity.expiresAt <= Date.now()) throw new UnauthorizedException();
    const session = await this.db.refreshToken.findFirst({
      where: {
        id: identity.sessionId,
        userId: identity.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      select: { id: true, user: { select: publicUserSelect } },
    });
    if (!session) throw new UnauthorizedException();
    return { user: session.user, sessionId: session.id };
  }
}
