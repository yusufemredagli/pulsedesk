import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HealthController } from '../src/health.controller';
import { configureHttpCors } from '../src/config/http-cors';
test('browser HTTP CORS permits only configured frontend origins and bearer/tenant headers', async () => {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          FRONTEND_ORIGINS: 'http://localhost:3000',
        }),
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureHttpCors(app);
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const allowed = await fetch(`${url}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'authorization,content-type,x-organization-id',
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'http://localhost:3000',
    );
    assert.ok(
      allowed.headers
        .get('access-control-allow-headers')
        ?.toLowerCase()
        .includes('x-organization-id'),
    );
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
    const removal = await fetch(`${url}/teams/example/members/example`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'authorization,x-organization-id',
      },
    });
    assert.equal(removal.status, 204);
    assert.match(
      removal.headers.get('access-control-allow-methods') ?? '',
      /DELETE/,
    );

    const denied = await fetch(`${url}/health`, {
      headers: { origin: 'https://foreign.example' },
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  } finally {
    await app.close();
  }
});
