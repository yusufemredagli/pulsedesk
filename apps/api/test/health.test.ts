import { RealtimeDispatchRuntime } from '../src/modules/realtime/realtime-dispatch-runtime';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AppModule } from '../src/app.module';
import { validateEnvironment } from '../src/config/environment';
test('GET /health returns the service readiness contract', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RealtimeDispatchRuntime)
    .useValue({})
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'pulsedesk-api',
    });
  } finally {
    await app.close();
  }
});
test('port configuration defaults and rejects invalid ports', () => {
  assert.equal(
    validateEnvironment({
      REDIS_URL: process.env.REDIS_URL,
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    }).PORT,
    4000,
  );
  for (const PORT of ['', 'abc', '0', '65536', '1.5']) {
    assert.throws(() =>
      validateEnvironment({
        REDIS_URL: process.env.REDIS_URL,
        PORT,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      }),
    );
  }
});
