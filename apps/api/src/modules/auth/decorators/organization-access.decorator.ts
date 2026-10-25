import { applyDecorators, UseGuards } from '@nestjs/common';
import type { OrganizationRole } from '../../../generated/prisma/client';
import { AccessTokenGuard } from '../guards/access-token.guard';
import { OrganizationGuard } from '../guards/organization.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';
export const OrganizationAccess = (...roles: OrganizationRole[]) =>
  applyDecorators(
    Roles(...roles),
    UseGuards(AccessTokenGuard, OrganizationGuard, RolesGuard),
  );
