import { nextUpdatedAt } from '../../common/resource-edit';
import { ticketStatistics } from '../../common/ticket-statistics';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  audit,
  DomainTransaction,
  MANAGERS,
} from '../../common/domain-transaction.service';
import { mapMember, mapTeam, memberSelect } from '../../common/public-mappers';
import {
  type PageQuery,
  pagination,
  searchText,
} from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';
@Injectable()
export class TeamsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  async list(context: TenantContext, query: PageQuery) {
    const where: Prisma.TeamWhereInput = {
      organizationId: context.organizationId,
      ...(query.search
        ? { name: { contains: searchText(query.search), mode: 'insensitive' } }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.team.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            _count: {
              select: {
                members: { where: { organizationId: context.organizationId } },
              },
            },
          },
        });
        const total = await tx.team.count({ where });
        const stats = await ticketStatistics(
          tx,
          context,
          'assignedTeamId',
          rows.map((row) => row.id),
        );
        return {
          data: rows.map((row) => ({
            ...mapTeam(row),
            memberCount: row._count.members,
            statistics: stats.get(row.id)!,
          })),
          pagination: pagination(query, total),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async get(context: TenantContext, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const team = await tx.team.findFirst({
          where: { id, organizationId: context.organizationId },
          include: {
            _count: { select: { members: true } },
            members: {
              take: 101,
              where: { organizationId: context.organizationId },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { createdAt: true, member: { select: memberSelect } },
            },
          },
        });
        if (!team) throw new NotFoundException();
        return {
          ...mapTeam(team),
          memberCount: team._count.members,
          statistics: (
            await ticketStatistics(tx, context, 'assignedTeamId', [team.id])
          ).get(team.id)!,
          membersHasMore: team.members.length > 100,
          members: team.members.slice(0, 100).map((entry) => ({
            member: mapMember(entry.member),
            createdAt: entry.createdAt,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async members(context: TenantContext, id: string, query: PageQuery) {
    return this.db.$transaction(
      async (tx) => {
        if (
          !(await tx.team.findFirst({
            where: { id, organizationId: context.organizationId },
            select: { id: true },
          }))
        )
          throw new NotFoundException();
        const where = {
          organizationId: context.organizationId,
          teamId: id,
          ...(query.search
            ? {
                member: {
                  user: {
                    name: {
                      contains: searchText(query.search),
                      mode: 'insensitive' as const,
                    },
                  },
                },
              }
            : {}),
        };
        const rows = await tx.teamMember.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            createdAt: true,
            member: {
              select: {
                ...memberSelect,
                role: true,
                user: {
                  select: { ...memberSelect.user.select, isActive: true },
                },
              },
            },
          },
        });
        return {
          data: rows.map((row) => ({
            ...mapMember(row.member)!,
            role: row.member.role,
            isActive: row.member.user.isActive,
            createdAt: row.createdAt,
          })),
          pagination: pagination(query, await tx.teamMember.count({ where })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async editable(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
    expected?: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "organizationId"=${context.organizationId}::uuid AND "id"=${id}::uuid FOR NO KEY UPDATE`;
    const row = await tx.team.findFirst({
      where: { id, organizationId: context.organizationId },
    });
    if (!row) throw new NotFoundException();
    return nextUpdatedAt(row.updatedAt, expected);
  }
  create(context: TenantContext, input: CreateTeamDto) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const team = await tx.team.create({
        data: {
          organizationId: context.organizationId,
          name: input.name,
          description: input.description,
        },
      });
      await audit(tx, context, 'TEAM_CREATED', 'Team', team.id);
      return mapTeam(team);
    });
  }
  update(context: TenantContext, id: string, input: UpdateTeamDto) {
    if (input.name === undefined && input.description === undefined)
      throw new BadRequestException();
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const updatedAt = await this.editable(
        tx,
        context,
        id,
        input.expectedUpdatedAt,
      );
      const team = await tx.team.update({
        where: {
          organizationId_id: { organizationId: context.organizationId, id },
        },
        data: { name: input.name, description: input.description, updatedAt },
      });
      await audit(tx, context, 'TEAM_UPDATED', 'Team', id);
      return mapTeam(team);
    });
  }
  addMember(
    context: TenantContext,
    teamId: string,
    membershipId: string,
    expectedUpdatedAt?: string,
  ) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const updatedAt = await this.editable(
        tx,
        context,
        teamId,
        expectedUpdatedAt,
      );
      const active = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT m."id" FROM "OrganizationMember" m JOIN "User" u ON u."id"=m."userId" WHERE m."id"=${membershipId}::uuid AND m."organizationId"=${context.organizationId}::uuid AND u."isActive"=true FOR SHARE OF m,u`;
      if (!active.length) throw new NotFoundException();
      const member = await tx.organizationMember.findFirst({
        where: {
          id: membershipId,
          organizationId: context.organizationId,
          user: { isActive: true },
        },
        select: memberSelect,
      });
      if (!member) throw new NotFoundException();
      const entry = await tx.teamMember.create({
        data: {
          organizationId: context.organizationId,
          teamId,
          memberId: membershipId,
        },
      });
      await tx.team.update({
        where: {
          organizationId_id: {
            organizationId: context.organizationId,
            id: teamId,
          },
        },
        data: { updatedAt },
      });
      await audit(tx, context, 'TEAM_MEMBER_ADDED', 'Team', teamId, {
        membershipId,
      });
      return {
        membershipId,
        teamId,
        createdAt: entry.createdAt,
        member: mapMember(member),
      };
    });
  }
  removeMember(
    context: TenantContext,
    teamId: string,
    membershipId: string,
    expectedUpdatedAt?: string,
  ) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const updatedAt = await this.editable(
        tx,
        context,
        teamId,
        expectedUpdatedAt,
      );
      // Coordinate team-removal with assignment and team-based agent commands.
      await tx.$queryRaw`SELECT "id" FROM "TeamMember" WHERE "organizationId"=${context.organizationId}::uuid AND "teamId"=${teamId}::uuid AND "memberId"=${membershipId}::uuid FOR UPDATE`;
      const removed = await tx.teamMember.deleteMany({
        where: {
          organizationId: context.organizationId,
          teamId,
          memberId: membershipId,
        },
      });
      if (!removed.count) throw new NotFoundException();
      await tx.team.update({
        where: {
          organizationId_id: {
            organizationId: context.organizationId,
            id: teamId,
          },
        },
        data: { updatedAt },
      });
      await audit(tx, context, 'TEAM_MEMBER_REMOVED', 'Team', teamId, {
        membershipId,
      });
    });
  }
}
