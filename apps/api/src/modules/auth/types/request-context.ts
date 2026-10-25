import type { Request } from 'express';
import type {
  OrganizationRole,
  Prisma,
} from '../../../generated/prisma/client';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isActive: true,
} satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
export interface AuthContext {
  readonly user: PublicUser;
  readonly sessionId: string;
}
export interface TenantContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly role: OrganizationRole;
}
export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  tenant?: TenantContext;
}
