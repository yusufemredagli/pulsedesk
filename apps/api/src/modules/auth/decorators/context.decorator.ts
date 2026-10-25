import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthenticatedRequest,
  PublicUser,
  TenantContext,
} from '../types/request-context';
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    return auth.user;
  },
);
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const tenant = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().tenant;
    if (!tenant) throw new ForbiddenException();
    return tenant;
  },
);
