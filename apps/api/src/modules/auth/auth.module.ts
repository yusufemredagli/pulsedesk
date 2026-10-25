import { AccessTokenService } from './access-token.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { OrganizationSlugService } from './organization-slug.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { OrganizationGuard } from './guards/organization.guard';
import { RolesGuard } from './guards/roles.guard';
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.getOrThrow<number>('JWT_ACCESS_TTL'),
          issuer: 'pulsedesk-api',
          audience: 'pulsedesk-web',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'pulsedesk-api',
          audience: 'pulsedesk-web',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    OrganizationSlugService,
    AccessTokenService,
    AccessTokenGuard,
    OrganizationGuard,
    RolesGuard,
  ],
  exports: [
    JwtModule,
    DatabaseModule,
    AccessTokenService,
    AccessTokenGuard,
    OrganizationGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
