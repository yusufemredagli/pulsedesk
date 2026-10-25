import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
test('readiness checks dependencies and liveness stays healthy during a Redis outage', async () => {
  let unavailable = false;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: async () => [{ value: 1 }] })
    .overrideProvider(RedisService)
    .useValue({
      ping: async () => {
        if (unavailable) throw new Error('private connection details');
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    assert.equal((await fetch(`${url}/ready`)).status, 200);
    unavailable = true;
    const response = await fetch(`${url}/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      statusCode: 503,
      message: 'Dependencies unavailable',
    });
    assert.equal((await fetch(`${url}/health`)).status, 200);
  } finally {
    await app.close();
  }
});
