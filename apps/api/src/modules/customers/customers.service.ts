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
import { mapCustomer } from '../../common/public-mappers';
import { pagination, searchText } from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQuery,
} from './dto/customer.dto';
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  async list(context: TenantContext, query: CustomerQuery) {
    const term = query.search ? searchText(query.search) : undefined;
    const where: Prisma.CustomerWhereInput = {
      organizationId: context.organizationId,
      ...(term
        ? {
            OR: ['name', 'email', 'phone', 'companyName'].map((field) => ({
              [field]: { contains: term, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const [field, direction] = query.sort.split(':') as [
          'name' | 'createdAt',
          'asc' | 'desc',
        ];
        const rows = await tx.customer.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ [field]: direction }, { id: 'desc' }],
        });
        const total = await tx.customer.count({ where });
        const stats = await ticketStatistics(
          tx,
          context,
          'customerId',
          rows.map((row) => row.id),
        );
        return {
          data: rows.map((row) => ({
            ...mapCustomer(row),
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
        const row = await tx.customer.findFirst({
          where: { organizationId: context.organizationId, id },
        });
        if (!row) throw new NotFoundException();
        return {
          ...mapCustomer(row),
          statistics: (
            await ticketStatistics(tx, context, 'customerId', [row.id])
          ).get(row.id)!,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  create(context: TenantContext, input: CreateCustomerDto) {
    return this.transactions.run(context, MANAGERS, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: context.organizationId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          companyName: input.companyName,
          notes: input.notes,
        },
      });
      await audit(tx, context, 'CUSTOMER_CREATED', 'Customer', customer.id);
      return mapCustomer(customer);
    });
  }
  update(context: TenantContext, id: string, input: UpdateCustomerDto) {
    if (
      !Object.entries(input).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      )
    )
      throw new BadRequestException();
    return this.transactions.run(context, MANAGERS, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "organizationId"=${context.organizationId}::uuid AND "id"=${id}::uuid FOR NO KEY UPDATE`;
      const current = await tx.customer.findFirst({
        where: { organizationId: context.organizationId, id },
      });
      if (!current) throw new NotFoundException();
      const customer = await tx.customer.update({
        where: {
          organizationId_id: { organizationId: context.organizationId, id },
        },
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          companyName: input.companyName,
          notes: input.notes,
          updatedAt: nextUpdatedAt(current.updatedAt, input.expectedUpdatedAt),
        },
      });
      await audit(tx, context, 'CUSTOMER_UPDATED', 'Customer', id);
      return mapCustomer(customer);
    });
  }
}
