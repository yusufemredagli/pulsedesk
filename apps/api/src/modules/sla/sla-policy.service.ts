import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SlaPolicy } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  audit,
  DomainTransaction,
} from '../../common/domain-transaction.service';
import { pagination, type PageQuery } from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type { CreatePolicyDto, UpdatePolicyDto } from './sla-policy.dto';
function mapped(row: SlaPolicy) {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    firstResponseMinutes: row.firstResponseMinutes,
    resolutionMinutes: row.resolutionMinutes,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
@Injectable()
export class SlaPolicyService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  async list(context: TenantContext, query: PageQuery) {
    const where = { organizationId: context.organizationId };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.slaPolicy.findMany({
          where,
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.db.slaPolicy.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data: rows.map(mapped), pagination: pagination(query, total) };
  }
  create(context: TenantContext, input: CreatePolicyDto) {
    return this.transactions.run(context, ['OWNER', 'ADMIN'], async (tx) => {
      const row = await tx.slaPolicy.create({
        data: {
          organizationId: context.organizationId,
          name: input.name,
          priority: input.priority,
          firstResponseMinutes: input.firstResponseMinutes,
          resolutionMinutes: input.resolutionMinutes,
          isActive: input.isActive,
        },
      });
      await audit(tx, context, 'SLA_POLICY_CREATED', 'SlaPolicy', row.id);
      return mapped(row);
    });
  }
  update(context: TenantContext, id: string, input: UpdatePolicyDto) {
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException();
    return this.transactions.run(context, ['OWNER', 'ADMIN'], async (tx) => {
      if (
        !(await tx.slaPolicy.findFirst({
          where: { id, organizationId: context.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      const row = await tx.slaPolicy.update({
        where: {
          organizationId_id: { organizationId: context.organizationId, id },
        },
        data: {
          name: input.name,
          priority: input.priority,
          firstResponseMinutes: input.firstResponseMinutes,
          resolutionMinutes: input.resolutionMinutes,
          isActive: input.isActive,
        },
      });
      await audit(tx, context, 'SLA_POLICY_UPDATED', 'SlaPolicy', row.id);
      return mapped(row);
    });
  }
}
