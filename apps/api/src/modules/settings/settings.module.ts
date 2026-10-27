import {
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { IsISO8601, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { DomainModule } from '../../common/domain.module';
import {
  DomainTransaction,
  audit,
} from '../../common/domain-transaction.service';
import { nextUpdatedAt } from '../../common/resource-edit';
import { trim } from '../../common/pagination.dto';
import { validationFor } from '../../common/validation';
import { PrismaService } from '../../infrastructure/database/prisma.service';
class NameUpdateDto {
  @Transform(trim) @IsString() @Length(1, 100) name!: string;
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
const accountSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  updatedAt: true,
} as const;
const workspaceSelect = {
  id: true,
  name: true,
  slug: true,
  updatedAt: true,
} as const;
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DomainTransaction) private readonly transactions: DomainTransaction,
  ) {}
  @Get()
  @OrganizationAccess()
  get(@CurrentTenant() context: TenantContext) {
    return this.db.$transaction(
      async (tx) => {
        const workspace = await tx.organization.findUnique({
          where: { id: context.organizationId },
          select: workspaceSelect,
        });
        const account = await tx.user.findFirst({
          where: {
            id: context.userId,
            isActive: true,
            memberships: {
              some: {
                id: context.membershipId,
                organizationId: context.organizationId,
              },
            },
          },
          select: accountSelect,
        });
        if (!workspace || !account) throw new NotFoundException();
        return { workspace, account, role: context.role };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  @Patch('workspace')
  @OrganizationAccess('OWNER', 'ADMIN')
  workspace(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(NameUpdateDto)) input: NameUpdateDto,
  ) {
    return this.transactions.run(context, ['OWNER', 'ADMIN'], async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${context.organizationId}::uuid FOR NO KEY UPDATE`;
      const current = await tx.organization.findUnique({
        where: { id: context.organizationId },
      });
      if (!current) throw new NotFoundException();
      const row = await tx.organization.update({
        where: { id: context.organizationId },
        data: {
          name: input.name,
          updatedAt: nextUpdatedAt(current.updatedAt, input.expectedUpdatedAt),
        },
        select: workspaceSelect,
      });
      await audit(
        tx,
        context,
        'ORGANIZATION_NAME_UPDATED',
        'Organization',
        row.id,
      );
      return row;
    });
  }
  @Patch('account')
  @OrganizationAccess()
  account(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(NameUpdateDto)) input: NameUpdateDto,
  ) {
    return this.transactions.run(
      context,
      ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'],
      async (tx) => {
        const current = await tx.user.findFirst({
          where: { id: context.userId, isActive: true },
          select: { id: true, updatedAt: true },
        });
        if (!current) throw new NotFoundException();
        const updatedAt = nextUpdatedAt(
          current.updatedAt,
          input.expectedUpdatedAt,
        );
        const updated = await tx.user.updateMany({
          where: {
            id: context.userId,
            isActive: true,
            updatedAt: current.updatedAt,
          },
          data: { name: input.name, updatedAt },
        });
        if (!updated.count) throw new ConflictException();
        const row = await tx.user.findUniqueOrThrow({
          where: { id: context.userId },
          select: accountSelect,
        });
        await audit(tx, context, 'ACCOUNT_NAME_UPDATED', 'User', row.id);
        return row;
      },
    );
  }
}
@Module({
  imports: [AuthModule, DomainModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
