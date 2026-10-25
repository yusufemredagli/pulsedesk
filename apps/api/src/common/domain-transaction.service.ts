import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma, type OrganizationRole } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { TenantContext } from '../modules/auth/types/request-context';
export const MANAGERS: OrganizationRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
export const OPERATORS: OrganizationRole[] = [...MANAGERS, 'AGENT'];
@Injectable()
export class DomainTransaction {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async run<T>(
    context: TenantContext,
    roles: readonly OrganizationRole[],
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const members = await tx.$queryRaw<
            Array<{ id: string; role: OrganizationRole }>
          >`
          SELECT m."id", m."role" FROM "OrganizationMember" m JOIN "User" u ON u."id" = m."userId"
          WHERE m."id" = ${context.membershipId}::uuid AND m."organizationId" = ${context.organizationId}::uuid
            AND m."userId" = ${context.userId}::uuid AND u."isActive" = true FOR SHARE OF m, u`;
          if (
            !members[0] ||
            !roles.includes(members[0].role) ||
            members[0].role !== context.role
          )
            throw new ForbiddenException();
          return work(tx);
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2034', 'P2025'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
}
export async function audit(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      organizationId: context.organizationId,
      actorMemberId: context.membershipId,
      action,
      entityType,
      entityId,
      ...(metadata ? { metadata } : {}),
    },
  });
}
