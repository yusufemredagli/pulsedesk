import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Clock } from '../../common/clock.module';
import { DomainTransaction } from '../../common/domain-transaction.service';
import { pagination } from '../../common/pagination.dto';
import type { TenantContext } from '../auth/types/request-context';
import type { NotificationQuery } from './notifications.dto';
function mapped(row: Notification) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    entityType: row.entityType,
    entityId: row.entityId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async list(context: TenantContext, query: NotificationQuery) {
    const where = {
      organizationId: context.organizationId,
      recipientMemberId: context.membershipId,
      ...(query.unread === undefined
        ? {}
        : { readAt: query.unread ? null : { not: null } }),
    };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.notification.findMany({
          where,
          take: query.limit,
          skip: (query.page - 1) * query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.db.notification.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data: rows.map(mapped), pagination: pagination(query, total) };
  }
  read(context: TenantContext, id: string) {
    return this.transactions.run(
      context,
      ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'],
      async (tx) => {
        const where = {
          id,
          organizationId: context.organizationId,
          recipientMemberId: context.membershipId,
        };
        await tx.notification.updateMany({
          where: { ...where, readAt: null },
          data: { readAt: this.clock.now() },
        });
        const row = await tx.notification.findFirst({ where });
        if (!row) throw new NotFoundException();
        return mapped(row);
      },
    );
  }
}
