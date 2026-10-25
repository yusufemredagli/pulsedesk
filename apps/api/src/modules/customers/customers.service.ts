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
import {
  type PageQuery,
  pagination,
  searchText,
} from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  async list(context: TenantContext, query: PageQuery) {
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
    const [rows, total] = await this.db.$transaction(
      [
        this.db.customer.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.db.customer.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map(mapCustomer),
      pagination: pagination(query, total),
    };
  }
  async get(context: TenantContext, id: string) {
    const customer = await this.db.customer.findFirst({
      where: { organizationId: context.organizationId, id },
    });
    if (!customer) throw new NotFoundException();
    return mapCustomer(customer);
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
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException();
    return this.transactions.run(context, MANAGERS, async (tx) => {
      if (
        !(await tx.customer.findFirst({
          where: { organizationId: context.organizationId, id },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
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
        },
      });
      await audit(tx, context, 'CUSTOMER_UPDATED', 'Customer', id);
      return mapCustomer(customer);
    });
  }
}
