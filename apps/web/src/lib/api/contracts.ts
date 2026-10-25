export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isActive: boolean;
}
export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  role: Role;
}
export interface Profile {
  user: PublicUser;
  memberships: Membership[];
}
export interface SessionResponse extends Profile {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
}
export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
}
export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  entityId: string | null;
  entityType: string | null;
}
export interface Page<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role);
}
export function validProfile(value: unknown): value is Profile {
  if (
    !isObject(value) ||
    !isObject(value.user) ||
    !Array.isArray(value.memberships)
  )
    return false;
  return (
    isUuid(value.user.id) &&
    typeof value.user.name === 'string' &&
    typeof value.user.email === 'string' &&
    value.user.isActive === true &&
    value.memberships.every(
      (m) =>
        isObject(m) &&
        isUuid(m.organizationId) &&
        isUuid(m.membershipId) &&
        typeof m.organizationName === 'string' &&
        typeof m.organizationSlug === 'string' &&
        isRole(m.role),
    )
  );
}
export function validSession(value: unknown): value is SessionResponse {
  return (
    validProfile(value) &&
    isObject(value) &&
    typeof value.accessToken === 'string' &&
    value.accessToken.length < 8192 &&
    value.accessToken.length > 20 &&
    typeof value.refreshToken === 'string' &&
    /^[A-Za-z0-9_-]{64}$/.test(value.refreshToken) &&
    typeof value.accessTokenExpiresIn === 'number' &&
    value.accessTokenExpiresIn > 0 &&
    value.accessTokenExpiresIn <= 1200 &&
    typeof value.refreshTokenExpiresAt === 'string' &&
    Number.isFinite(Date.parse(value.refreshTokenExpiresAt))
  );
}
