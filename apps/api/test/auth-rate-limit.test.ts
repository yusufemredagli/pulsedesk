import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

test('real Nest rate limiter protects login, registration, and refresh', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RealtimeDispatchRuntime)
    .useValue({})
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthService)
    .useValue({ register: () => ({}), login: () => ({}), refresh: () => ({}) })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    for (const [path, limit, body] of [
      [
        'login',
        10,
        { email: 'rate@example.invalid', password: 'long-test-password' },
      ],
      [
        'register',
        10,
        {
          email: 'rate@example.invalid',
          password: 'long-test-password',
          name: 'Rate',
          organizationName: 'Limit',
        },
      ],
      ['refresh', 30, { refreshToken: 'a'.repeat(64) }],
    ] as const) {
      for (let attempt = 0; attempt <= limit; attempt++) {
        const response = await fetch(`${await app.getUrl()}/auth/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(
          response.status,
          attempt === limit ? 429 : path === 'register' ? 201 : 200,
        );
        if (attempt === limit) {
          assert.ok(response.headers.get('retry-after'));
          assert.deepEqual(await response.json(), {
            statusCode: 429,
            message: 'Too many requests',
          });
        }
      }
    }
  } finally {
    await app.close();
  }
});
