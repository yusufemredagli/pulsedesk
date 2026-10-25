import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedRequest } from '../types/request-context';
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthorizedException();
    const organizationId = request.headers['x-organization-id'];
    if (typeof organizationId !== 'string' || !isUUID(organizationId))
      throw new BadRequestException('Valid X-Organization-Id required');
    const membership = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: request.auth.user.id },
      },
      select: {
        id: true,
        role: true,
        organizationId: true,
        userId: true,
        user: { select: { isActive: true } },
        organization: { select: { id: true } },
      },
    });
    if (!membership?.user.isActive) throw new ForbiddenException();
    request.tenant = {
      userId: membership.userId,
      organizationId: membership.organization.id,
      membershipId: membership.id,
      role: membership.role,
    };
    return true;
  }
}
