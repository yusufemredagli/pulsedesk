import { recordTicketChange } from '../../infrastructure/outbox/realtime-records';
import { SlaService } from '../sla/sla.service';
import { Clock } from '../../common/clock.module';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type TicketStatus,
  type Ticket,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  audit,
  DomainTransaction,
  MANAGERS,
  OPERATORS,
} from '../../common/domain-transaction.service';
import { mapMember, memberSelect } from '../../common/public-mappers';
import { pagination, searchText } from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type {
  AssignTicketDto,
  CreateCommentDto,
  CreateTicketDto,
  TicketQuery,
  TransitionDto,
  CancelTicketDto,
} from './dto/ticket.dto';
import {
  accessibleTickets,
  transitions,
  type Transition,
} from './policies/ticket.policy';
import { mapTicket, timeline } from './mappers/ticket.mapper';
@Injectable()
export class TicketsService {
  constructor(
    @Inject(SlaService) private readonly sla: SlaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  create(context: TenantContext, input: CreateTicketDto) {
    return this.transactions.run(context, OPERATORS, async (tx) => {
      if (
        !(await tx.customer.findFirst({
          where: {
            id: input.customerId,
            organizationId: context.organizationId,
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const numbers = await tx.$queryRaw<
        Array<{ lastNumber: number }>
      >`INSERT INTO "OrganizationTicketCounter" ("organizationId","lastNumber") VALUES (${context.organizationId}::uuid,1) ON CONFLICT ("organizationId") DO UPDATE SET "lastNumber"="OrganizationTicketCounter"."lastNumber"+1 WHERE "OrganizationTicketCounter"."lastNumber" < 2147483647 RETURNING "lastNumber"`;
      if (!numbers[0]) throw new ConflictException();
      const ticket = await tx.ticket.create({
        data: {
          organizationId: context.organizationId,
          customerId: input.customerId,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          source: input.source,
          status: 'OPEN',
          ticketNumber: numbers[0].lastNumber,
        },
      });
      await recordTicketChange(
        tx,
        ticket,
        {
          type: 'TICKET_CREATED',
          status: ticket.status,
          priority: ticket.priority,
        },
        ticket.createdAt,
      );
      await this.sla.create(tx, ticket);
      await this.history(tx, context, ticket.id, null, 'OPEN');
      await audit(tx, context, 'TICKET_CREATED', 'Ticket', ticket.id, {
        ticketNumber: ticket.ticketNumber,
      });
      return this.mapped(tx, context, ticket.id);
    });
  }
  async list(context: TenantContext, query: TicketQuery) {
    const search: Prisma.TicketWhereInput[] = [];
    if (query.search) {
      search.push({
        subject: { contains: searchText(query.search), mode: 'insensitive' },
      });
      const matched = /^(?:PD-)?(\d+)$/i.exec(query.search);
      const number = matched ? Number(matched[1]) : 0;
      if (Number.isSafeInteger(number) && number > 0 && number <= 2147483647)
        search.push({ ticketNumber: number });
    }
    const where: Prisma.TicketWhereInput = {
      AND: [
        accessibleTickets(context),
        {
          status: query.status,
          priority: query.priority,
          customerId: query.customerId,
          assignedTeamId: query.assignedTeamId,
          assignedMemberId: query.assignedMemberId,
        },
        ...(search.length ? [{ OR: search }] : []),
      ],
    };
    const sorts: Record<string, Prisma.TicketOrderByWithRelationInput> = {
      'createdAt:desc': { createdAt: 'desc' },
      'createdAt:asc': { createdAt: 'asc' },
      'updatedAt:desc': { updatedAt: 'desc' },
      'updatedAt:asc': { updatedAt: 'asc' },
      'ticketNumber:desc': { ticketNumber: 'desc' },
      'ticketNumber:asc': { ticketNumber: 'asc' },
      'priority:desc': { priority: 'desc' },
      'priority:asc': { priority: 'asc' },
    };
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.ticket.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [sorts[query.sort]!, { id: 'desc' }],
        });
        const total = await tx.ticket.count({ where });
        const sla = await tx.slaEvent.findMany({
          where: {
            organizationId: context.organizationId,
            ticketId: { in: rows.map((row) => row.id) },
          },
          select: {
            id: true,
            ticketId: true,
            type: true,
            dueAt: true,
            completedAt: true,
            breachedAt: true,
          },
        });
        const related = await this.related(tx, context, rows);
        return {
          data: rows.map((row) => ({
            ...related.ticket(row),
            sla: sla
              .filter((event) => event.ticketId === row.id)
              .map((event) => ({
                id: event.id,
                type: event.type,
                dueAt: event.dueAt,
                completedAt: event.completedAt,
                breachedAt: event.breachedAt,
              })),
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
        const ticket = await tx.ticket.findFirst({
          where: { ...accessibleTickets(context), id },
        });
        if (!ticket) throw new NotFoundException();
        const slaEvents = await tx.slaEvent.findMany({
          where: { organizationId: context.organizationId, ticketId: id },
          orderBy: { type: 'asc' },
        });
        const orderBy = [
          { createdAt: 'desc' as const },
          { id: 'desc' as const },
        ];
        const where = { organizationId: context.organizationId, ticketId: id };
        const commentRows = await tx.ticketComment.findMany({
          where,
          take: 101,
          orderBy,
        });
        const statusRows = await tx.ticketStatusHistory.findMany({
          where,
          take: 101,
          orderBy,
        });
        const assignmentRows = await tx.ticketAssignment.findMany({
          where,
          take: 101,
          orderBy,
        });
        const related = await this.related(
          tx,
          context,
          [ticket],
          [
            ...commentRows.map((row) => row.authorMemberId),
            ...statusRows.map((row) => row.changedByMemberId),
            ...assignmentRows.flatMap((row) => [
              row.assignedByMemberId,
              ...(row.assignedMemberId ? [row.assignedMemberId] : []),
            ]),
          ],
          assignmentRows.flatMap((row) =>
            row.assignedTeamId ? [row.assignedTeamId] : [],
          ),
        );
        const comments = timeline(commentRows),
          statuses = timeline(statusRows),
          assignments = timeline(assignmentRows);
        return {
          ...related.ticket(ticket),
          description: ticket.description,
          sla: slaEvents.map((event) => ({
            id: event.id,
            type: event.type,
            dueAt: event.dueAt,
            completedAt: event.completedAt,
            breachedAt: event.breachedAt,
            status: event.breachedAt
              ? 'BREACHED'
              : event.completedAt
                ? 'COMPLETED'
                : ticket.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'PENDING',
          })),
          comments: comments.data.map((row) => ({
            id: row.id,
            body: row.body,
            visibility: row.visibility,
            author: related.member(row.authorMemberId),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
          statusHistory: statuses.data.map((row) => ({
            id: row.id,
            fromStatus: row.fromStatus,
            toStatus: row.toStatus,
            changedBy: related.member(row.changedByMemberId),
            reason: row.reason,
            createdAt: row.createdAt,
          })),
          assignmentHistory: assignments.data.map((row) => ({
            id: row.id,
            assignedMember: related.member(row.assignedMemberId),
            assignedTeam: related.team(row.assignedTeamId),
            assignedBy: related.member(row.assignedByMemberId),
            createdAt: row.createdAt,
          })),
          historyHasMore: {
            comments: comments.hasMore,
            statusHistory: statuses.hasMore,
            assignmentHistory: assignments.hasMore,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  assign(context: TenantContext, id: string, input: AssignTicketDto) {
    if (!input.assignedMemberId && !input.assignedTeamId)
      throw new BadRequestException();
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const ticket = await this.current(tx, context, id);
      if (
        ticket.version !== input.expectedVersion ||
        !['TRIAGED', 'ASSIGNED'].includes(ticket.status)
      )
        throw new ConflictException();
      if (
        input.assignedTeamId &&
        !(await tx.team.findFirst({
          where: {
            id: input.assignedTeamId,
            organizationId: context.organizationId,
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      if (input.assignedMemberId) {
        const members = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT m."id" FROM "OrganizationMember" m JOIN "User" u ON u."id"=m."userId" WHERE m."id"=${input.assignedMemberId}::uuid AND m."organizationId"=${context.organizationId}::uuid AND u."isActive"=true FOR SHARE OF m,u`;
        if (!members.length) throw new NotFoundException();
      }
      if (input.assignedMemberId && input.assignedTeamId) {
        const members = await this.lockTeamMembership(
          tx,
          context,
          input.assignedTeamId,
          input.assignedMemberId,
        );
        if (!members) throw new ConflictException();
      }
      const assignedMemberId = input.assignedMemberId ?? null,
        assignedTeamId = input.assignedTeamId ?? null;
      if (
        ticket.status === 'ASSIGNED' &&
        ticket.assignedMemberId === assignedMemberId &&
        ticket.assignedTeamId === assignedTeamId
      )
        throw new ConflictException();
      await this.update(tx, context, id, ticket.version, ticket.status, {
        assignedMemberId,
        assignedTeamId,
        status: 'ASSIGNED',
      });
      await tx.ticketAssignment.create({
        data: {
          organizationId: context.organizationId,
          ticketId: id,
          assignedMemberId,
          assignedTeamId,
          assignedByMemberId: context.membershipId,
        },
      });
      if (ticket.status !== 'ASSIGNED')
        await this.history(tx, context, id, ticket.status, 'ASSIGNED');
      await audit(
        tx,
        context,
        ticket.status === 'ASSIGNED' ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
        'Ticket',
        id,
        { assignedMemberId, assignedTeamId },
      );
      const next = { ...ticket, version: ticket.version + 1 };
      await recordTicketChange(
        tx,
        next,
        {
          type: 'TICKET_ASSIGNED',
          assignedMemberId,
          assignedTeamId,
          previousMemberId: ticket.assignedMemberId,
          previousTeamId: ticket.assignedTeamId,
        },
        this.clock.now(),
      );
      if (ticket.status !== 'ASSIGNED')
        await recordTicketChange(
          tx,
          next,
          {
            type: 'TICKET_STATUS_CHANGED',
            fromStatus: ticket.status,
            toStatus: 'ASSIGNED',
            actorMemberId: context.membershipId,
          },
          this.clock.now(),
        );
      return this.mapped(tx, context, id);
    });
  }
  transition(
    context: TenantContext,
    id: string,
    action: Transition,
    input: TransitionDto,
  ) {
    const rule = transitions[action];
    return this.transactions.run(context, rule.roles, async (tx) => {
      const ticket = await this.current(tx, context, id);
      if (
        ticket.version !== input.expectedVersion ||
        ticket.status !== rule.from
      )
        throw new ConflictException();
      const at = this.clock.now();
      await this.update(tx, context, id, ticket.version, rule.from, {
        status: rule.to,
        ...(rule.to === 'RESOLVED' ? { resolvedAt: at } : {}),
        ...(rule.to === 'CLOSED' ? { closedAt: at } : {}),
      });
      if (rule.to === 'RESOLVED')
        await this.sla.complete(tx, context, id, 'RESOLUTION');
      await this.history(tx, context, id, rule.from, rule.to, input.reason);
      await audit(tx, context, rule.audit, 'Ticket', id, {
        fromStatus: rule.from,
        toStatus: rule.to,
      });
      await recordTicketChange(
        tx,
        { ...ticket, version: ticket.version + 1 },
        {
          type: 'TICKET_STATUS_CHANGED',
          fromStatus: rule.from,
          toStatus: rule.to,
          actorMemberId: context.membershipId,
        },
        at,
      );
      return this.mapped(tx, context, id);
    });
  }
  cancel(context: TenantContext, id: string, input: CancelTicketDto) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const ticket = await this.current(tx, context, id);
      if (
        ticket.version !== input.expectedVersion ||
        !['OPEN', 'TRIAGED', 'ASSIGNED'].includes(ticket.status)
      )
        throw new ConflictException();
      await this.update(tx, context, id, ticket.version, ticket.status, {
        status: 'CANCELLED',
      });
      await this.history(
        tx,
        context,
        id,
        ticket.status,
        'CANCELLED',
        input.reason,
      );
      await audit(tx, context, 'TICKET_CANCELLED', 'Ticket', id, {
        fromStatus: ticket.status,
        toStatus: 'CANCELLED',
      });
      await recordTicketChange(
        tx,
        { ...ticket, version: ticket.version + 1 },
        {
          type: 'TICKET_STATUS_CHANGED',
          fromStatus: ticket.status,
          toStatus: 'CANCELLED',
          actorMemberId: context.membershipId,
        },
        this.clock.now(),
      );
      return this.mapped(tx, context, id);
    });
  }
  comment(context: TenantContext, id: string, input: CreateCommentDto) {
    return this.transactions.run(context, OPERATORS, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "organizationId"=${context.organizationId}::uuid AND "id"=${id}::uuid FOR SHARE`;
      const ticket = await this.current(tx, context, id);
      const comment = await tx.ticketComment.create({
        data: {
          organizationId: context.organizationId,
          ticketId: id,
          authorMemberId: context.membershipId,
          body: input.body,
          visibility: input.visibility,
        },
        include: { authorMember: { select: memberSelect } },
      });
      if (input.visibility === 'PUBLIC')
        await this.sla.complete(tx, context, id, 'FIRST_RESPONSE');
      await audit(tx, context, 'TICKET_COMMENT_ADDED', 'Ticket', id, {
        commentId: comment.id,
        visibility: comment.visibility,
      });
      await recordTicketChange(
        tx,
        ticket,
        {
          type: 'TICKET_COMMENT_ADDED',
          commentId: comment.id,
          visibility: comment.visibility,
          authorMemberId: context.membershipId,
        },
        comment.createdAt,
      );
      return {
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        author: mapMember(comment.authorMember),
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      };
    });
  }
  private async current(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
  ) {
    const ticket = await tx.ticket.findFirst({
      where: { ...accessibleTickets(context), id },
    });
    if (!ticket) throw new NotFoundException();
    if (
      context.role === 'AGENT' &&
      ticket.assignedMemberId !== context.membershipId
    ) {
      if (
        !ticket.assignedTeamId ||
        !(await this.lockTeamMembership(
          tx,
          context,
          ticket.assignedTeamId,
          context.membershipId,
        ))
      )
        throw new NotFoundException();
    }
    return ticket;
  }
  private async lockTeamMembership(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    teamId: string,
    memberId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "TeamMember" WHERE "organizationId"=${context.organizationId}::uuid AND "teamId"=${teamId}::uuid AND "memberId"=${memberId}::uuid FOR SHARE`;
    return rows.length > 0;
  }
  private async update(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
    version: number,
    status: TicketStatus,
    data: Pick<
      Prisma.TicketUncheckedUpdateManyInput,
      | 'status'
      | 'assignedMemberId'
      | 'assignedTeamId'
      | 'resolvedAt'
      | 'closedAt'
    >,
  ) {
    const result = await tx.ticket.updateMany({
      where: { id, organizationId: context.organizationId, version, status },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException();
  }
  private async mapped(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
  ) {
    const ticket = await tx.ticket.findFirst({
      where: { id, organizationId: context.organizationId },
    });
    if (!ticket) throw new NotFoundException();
    return (await this.related(tx, context, [ticket])).ticket(ticket);
  }
  private async related(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    tickets: Ticket[],
    extraMembers: string[] = [],
    extraTeams: string[] = [],
  ) {
    const customerIds = [
      ...new Set(tickets.map((ticket) => ticket.customerId)),
    ];
    const teamIds = [
      ...new Set([
        ...extraTeams,
        ...tickets.flatMap((ticket) =>
          ticket.assignedTeamId ? [ticket.assignedTeamId] : [],
        ),
      ]),
    ];
    const memberIds = [
      ...new Set([
        ...extraMembers,
        ...tickets.flatMap((ticket) =>
          ticket.assignedMemberId ? [ticket.assignedMemberId] : [],
        ),
      ]),
    ];
    // Bulk-load sequentially: one PostgreSQL transaction owns one connection.
    const customers = await tx.customer.findMany({
      where: {
        organizationId: context.organizationId,
        id: { in: customerIds },
      },
      select: { id: true, name: true, email: true, companyName: true },
    });
    const teams = await tx.team.findMany({
      where: { organizationId: context.organizationId, id: { in: teamIds } },
      select: { id: true, name: true },
    });
    const members = await tx.organizationMember.findMany({
      where: { organizationId: context.organizationId, id: { in: memberIds } },
      select: memberSelect,
    });
    const customerMap = new Map(customers.map((row) => [row.id, row]));
    const teamMap = new Map(teams.map((row) => [row.id, row]));
    const memberMap = new Map(members.map((row) => [row.id, row]));
    return {
      ticket: (ticket: Ticket) =>
        mapTicket({
          ...ticket,
          customer: customerMap.get(ticket.customerId)!,
          assignedTeam: ticket.assignedTeamId
            ? teamMap.get(ticket.assignedTeamId)!
            : null,
          assignedMember: ticket.assignedMemberId
            ? memberMap.get(ticket.assignedMemberId)!
            : null,
        }),
      member: (id: string | null) =>
        mapMember(id ? (memberMap.get(id) ?? null) : null),
      team: (id: string | null) => (id ? (teamMap.get(id) ?? null) : null),
    };
  }
  private async history(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    ticketId: string,
    fromStatus: TicketStatus | null,
    toStatus: TicketStatus,
    reason?: string,
  ) {
    await tx.ticketStatusHistory.create({
      data: {
        organizationId: context.organizationId,
        ticketId,
        changedByMemberId: context.membershipId,
        fromStatus,
        toStatus,
        reason,
      },
    });
  }
}
