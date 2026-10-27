import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertDemoEnvironment, seedDemo } from '../src/demo/seed-demo';
import { demoId } from '../src/demo/manifest';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
const local = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/pulsedesk_demo_test',
};
test('demo seed allows only local development/test PostgreSQL and never production', () => {
  for (const NODE_ENV of ['development', 'test', undefined])
    assert.doesNotThrow(() => assertDemoEnvironment({ ...local, NODE_ENV }));
  assert.doesNotThrow(() =>
    assertDemoEnvironment({
      ...local,
      DATABASE_URL: 'postgresql://[::1]/test',
    }),
  );
  for (const NODE_ENV of ['production', 'staging', 'PRODUCTION', ''])
    assert.throws(
      () => assertDemoEnvironment({ ...local, NODE_ENV }),
      /only in development or test/,
    );
  for (const DATABASE_URL of [
    '',
    'not-a-url',
    'https://localhost/test',
    'postgresql://remote.example/test',
    'postgresql://localhost/',
  ])
    assert.throws(() => assertDemoEnvironment({ ...local, DATABASE_URL }));
});
test('production refusal happens before any database or password work', async () => {
  await assert.rejects(
    seedDemo({} as PrismaService, { ...local, NODE_ENV: 'production' }),
    /production is always refused/,
  );
});
test('standalone production seed exits safely without exposing database credentials or demo password', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('src/demo/seed.ts')],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://demo:must-not-be-printed@remote.invalid/live',
      },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production demo seeding is forbidden/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /must-not-be-printed|DemoPass123|remote.invalid/,
  );
});
test('demo identities are deterministic namespaced UUIDs and distinct per entity', () => {
  assert.equal(demoId('organization'), demoId('organization'));
  assert.notEqual(demoId('user:OWNER'), demoId('membership:OWNER'));
  assert.match(
    demoId('ticket:1'),
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
});
