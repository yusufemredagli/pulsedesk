import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessTokenService } from '../access-token.service';
import type { AuthenticatedRequest } from '../types/request-context';
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || header.length > 8192 || !/^Bearer \S+$/i.test(header))
      throw new UnauthorizedException();
    request.auth = await this.tokens.authenticate(header.slice(7));
    return true;
  }
}
