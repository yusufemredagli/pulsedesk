import { SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '../../../generated/prisma/client';
export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: OrganizationRole[]) =>
  SetMetadata(ROLES_KEY, roles);
