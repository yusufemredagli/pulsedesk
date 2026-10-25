import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PasswordService } from './password.service';
import { OrganizationSlugService } from './organization-slug.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { publicUserSelect } from './types/request-context';

class OrganizationSlugConflict extends Error {}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(OrganizationSlugService)
    private readonly slugs: OrganizationSlugService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(input.password);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { name: input.name.trim(), email, passwordHash },
            select: publicUserSelect,
          });
          const organization = await this.createOrganization(
            tx,
            input.organizationName,
          );
          await tx.organizationMember.create({
            data: {
              userId: user.id,
              organizationId: organization.id,
              role: 'OWNER',
            },
          });
          return {
            ...(await this.createSession(tx, user.id)),
            ...(await this.profile(tx, user.id)),
          };
        });
      } catch (error: unknown) {
        if (error instanceof OrganizationSlugConflict) continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Account already exists');
        }
        throw error;
      }
    }
    throw new ConflictException('Organization conflict');
  }

  private async createOrganization(tx: Prisma.TransactionClient, name: string) {
    try {
      return await tx.organization.create({
        data: { name: name.trim(), slug: this.slugs.create(name) },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new OrganizationSlugConflict();
      throw error;
    }
  }

  async login(input: LoginDto) {
    const user = await this.db.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true, isActive: true, passwordHash: true },
    });
    const valid = await this.passwords.matches(
      input.password,
      user?.passwordHash,
    );
    if (!valid || !user?.isActive) throw new UnauthorizedException();
    return this.db.$transaction(async (tx) => {
      await this.lockUser(tx, user.id);
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { isActive: true },
      });
      if (!current?.isActive) throw new UnauthorizedException();
      return {
        ...(await this.createSession(tx, user.id)),
        ...(await this.profile(tx, user.id)),
      };
    });
  }

  async refresh(token: string) {
    const tokenHash = this.hashToken(token);
    return this.db.$transaction(async (tx) => {
      const previous = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });
      if (!previous) throw new UnauthorizedException();
      await this.lockUser(tx, previous.userId);
      const user = await tx.user.findUnique({
        where: { id: previous.userId },
        select: { isActive: true },
      });
      if (!user?.isActive) throw new UnauthorizedException();
      const now = new Date();
      const consumed = await tx.refreshToken.updateMany({
        where: { id: previous.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) throw new UnauthorizedException();
      return {
        ...(await this.createSession(tx, previous.userId)),
        ...(await this.profile(tx, previous.userId)),
      };
    });
  }

  async logout(token: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    return this.profile(this.db, userId);
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }

  private async createSession(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    const sessions = await tx.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (sessions.length >= 10) {
      await tx.refreshToken.updateMany({
        where: {
          id: {
            in: sessions
              .slice(0, sessions.length - 9)
              .map((session) => session.id),
          },
        },
        data: { revokedAt: now },
      });
    }
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      now.getTime() +
        this.config.getOrThrow<number>('REFRESH_TOKEN_TTL') * 1000,
    );
    const session = await tx.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(refreshToken), expiresAt },
      select: { id: true },
    });
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.config.getOrThrow<number>('JWT_ACCESS_TTL'),
      refreshTokenExpiresAt: expiresAt,
    };
  }

  private async profile(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
    if (!user?.isActive) throw new UnauthorizedException();
    const memberships = await tx.organizationMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    return {
      user,
      memberships: memberships.map((member) => ({
        organizationId: member.organization.id,
        organizationName: member.organization.name,
        organizationSlug: member.organization.slug,
        membershipId: member.id,
        role: member.role,
      })),
    };
  }
}
