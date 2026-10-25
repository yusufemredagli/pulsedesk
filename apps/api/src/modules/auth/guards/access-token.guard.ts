import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  publicUserSelect,
  type AuthenticatedRequest,
} from '../types/request-context';
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || header.length > 8192 || !/^Bearer \S+$/i.test(header))
      throw new UnauthorizedException();
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        header.slice(7),
        {
          algorithms: ['HS256'],
          issuer: 'pulsedesk-api',
          audience: 'pulsedesk-web',
        },
      );
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
    const session = await this.db.refreshToken.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      select: { id: true, user: { select: publicUserSelect } },
    });
    if (!session) throw new UnauthorizedException();
    request.auth = { user: session.user, sessionId: session.id };
    return true;
  }
}
