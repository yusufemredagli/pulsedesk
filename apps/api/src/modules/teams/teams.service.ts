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
    const [rows, total] = await this.db.$transaction(
      [
        this.db.team.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.db.team.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data: rows.map(mapTeam), pagination: pagination(query, total) };
  }
  async get(context: TenantContext, id: string) {
    const team = await this.db.team.findFirst({
      where: { id, organizationId: context.organizationId },
      include: {
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
      membersHasMore: team.members.length > 100,
      members: team.members.slice(0, 100).map((entry) => ({
        member: mapMember(entry.member),
        createdAt: entry.createdAt,
      })),
    };
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
      if (
        !(await tx.team.findFirst({
          where: { id, organizationId: context.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const team = await tx.team.update({
        where: {
          organizationId_id: { organizationId: context.organizationId, id },
        },
        data: { name: input.name, description: input.description },
      });
      await audit(tx, context, 'TEAM_UPDATED', 'Team', id);
      return mapTeam(team);
    });
  }
  addMember(context: TenantContext, teamId: string, membershipId: string) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      if (
        !(await tx.team.findFirst({
          where: { id: teamId, organizationId: context.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
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
  removeMember(context: TenantContext, teamId: string, membershipId: string) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      if (
        !(await tx.team.findFirst({
          where: { id: teamId, organizationId: context.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
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
      await audit(tx, context, 'TEAM_MEMBER_REMOVED', 'Team', teamId, {
        membershipId,
      });
    });
  }
}
