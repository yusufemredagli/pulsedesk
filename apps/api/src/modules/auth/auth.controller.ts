import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { validationFor } from '../../common/validation';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { AccessTokenGuard } from './guards/access-token.guard';
import { CurrentTenant, CurrentUser } from './decorators/context.decorator';
import { OrganizationAccess } from './decorators/organization-access.decorator';
import type { PublicUser, TenantContext } from './types/request-context';
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  register(@Body(validationFor(RegisterDto)) body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body(validationFor(LoginDto)) body: LoginDto) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  refresh(@Body(validationFor(RefreshTokenDto)) body: RefreshTokenDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  logout(@Body(validationFor(RefreshTokenDto)) body: RefreshTokenDto) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: PublicUser) {
    return this.auth.me(user.id);
  }

  @Get('context')
  @Header('Cache-Control', 'no-store')
  @OrganizationAccess()
  context(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }

  @Get('owner-only')
  @Header('Cache-Control', 'no-store')
  @OrganizationAccess('OWNER')
  ownerOnly(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }
}
