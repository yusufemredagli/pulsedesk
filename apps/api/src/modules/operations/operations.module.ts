import type { Prisma } from '../../generated/prisma/client';
import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { IsUUID, ValidateIf } from 'class-validator';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { accessibleTickets } from '../tickets/policies/ticket.policy';
import {
  PageQuery,
  optional,
  pagination,
  searchText,
} from '../../common/pagination.dto';
import { validationFor } from '../../common/validation';
import { memberSelect, mapMember } from '../../common/public-mappers';
export class MemberQuery extends PageQuery {
  @ValidateIf(optional) @IsUUID() teamId?: string;
}
@Controller()
export class OperationsController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Get('dashboard/summary')
  @OrganizationAccess()
  summary(@CurrentTenant() context: TenantContext) {
    const scope = accessibleTickets(context);
    const now = new Date();
    const active = {
      notIn: ['CLOSED', 'CANCELLED', 'RESOLVED'] as (
        'CLOSED' | 'CANCELLED' | 'RESOLVED'
      )[],
    };
    return this.db.$transaction(
      async (tx) => {
        const count = (where: Prisma.TicketWhereInput) =>
          tx.ticket.count({ where: { AND: [scope, where] } });
        const open = await count({ status: active });
        const urgent = await count({ status: active, priority: 'URGENT' });
        const unassigned = await count({
          status: active,
          assignedMemberId: null,
          assignedTeamId: null,
        });
        const activeWork = await count({ status: 'IN_PROGRESS' });
        const atRisk = await count({
          status: active,
          slaEvents: {
            some: {
              completedAt: null,
              breachedAt: null,
              dueAt: { gt: now, lte: new Date(now.getTime() + 1800000) },
            },
          },
        });
        const breached = await count({
          status: active,
          slaEvents: {
            some: {
              OR: [
                { breachedAt: { not: null } },
                { completedAt: null, dueAt: { lte: now } },
              ],
            },
          },
        });
        return {
          open,
          urgent,
          unassigned,
          activeWork,
          atRisk,
          breached,
          asOf: now.toISOString(),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  @Get('organization/members')
  @OrganizationAccess()
  members(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(MemberQuery)) query: MemberQuery,
  ) {
    const where = {
      organizationId: context.organizationId,
      user: {
        isActive: true,
        ...(query.search
          ? {
              name: {
                contains: searchText(query.search),
                mode: 'insensitive' as const,
              },
            }
          : {}),
      },
      ...(query.teamId
        ? {
            teamMemberships: {
              some: {
                organizationId: context.organizationId,
                teamId: query.teamId,
              },
            },
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.organizationMember.findMany({
          where,
          select: memberSelect,
          orderBy: { id: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        });
        const total = await tx.organizationMember.count({ where });
        return {
          data: rows.map(mapMember),
          pagination: pagination(query, total),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
@Module({ imports: [AuthModule], controllers: [OperationsController] })
export class OperationsModule {}
