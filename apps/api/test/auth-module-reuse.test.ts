import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Controller, Get, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { OrganizationAccess } from '../src/modules/auth/decorators/organization-access.decorator';
import { CurrentTenant } from '../src/modules/auth/decorators/context.decorator';
import type { TenantContext } from '../src/modules/auth/types/request-context';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

@Controller('test-only-guard-reuse')
class GuardFixtureController {
  @Get()
  @OrganizationAccess('OWNER')
  context(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }
}
@Module({ imports: [AuthModule], controllers: [GuardFixtureController] })
class GuardFixtureModule {}

test('organization guards and decorators work from a separate importing module', async () => {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  const module = await Test.createTestingModule({
    imports: [AppModule, GuardFixtureModule],
  })
    .overrideProvider(RealtimeDispatchRuntime)
    .useValue({})
    .overrideProvider(PrismaService)
    .useValue({
      refreshToken: {
        findFirst: async () => ({
          id: sessionId,
          user: {
            id: userId,
            name: 'Fixture',
            email: 'fixture@example.invalid',
            avatarUrl: null,
            isActive: true,
          },
        }),
      },
      organizationMember: {
        findUnique: async () => ({
          id: membershipId,
          userId,
          organizationId,
          role: 'OWNER',
          user: { isActive: true },
          organization: { id: organizationId },
        }),
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const jwt = await app
      .get(JwtService)
      .signAsync({ sub: userId, sid: sessionId });
    const response = await fetch(
      `${await app.getUrl()}/test-only-guard-reuse`,
      {
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-organization-id': organizationId,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      userId,
      organizationId,
      membershipId,
      role: 'OWNER',
    });
  } finally {
    await app.close();
  }
});
