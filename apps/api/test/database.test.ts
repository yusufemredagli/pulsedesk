import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  PrismaService,
  utcConnectionString,
} from '../src/infrastructure/database/prisma.service';

test('Prisma lifecycle awaits connection and disconnection', async () => {
  const service = new PrismaService(
    new ConfigService({
      DATABASE_URL: 'postgresql://localhost/pulsedesk_test',
    }),
  );
  const connect = mock.fn(async () => {});
  service.$connect = connect;
  const disconnect = mock.fn(async () => {});
  service.$disconnect = disconnect;
  await service.onModuleInit();
  await service.onApplicationShutdown();
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(disconnect.mock.callCount(), 1);
});

test('Prisma initialization failures propagate to Nest', async () => {
  const service = new PrismaService(
    new ConfigService({
      DATABASE_URL: 'postgresql://localhost/pulsedesk_test',
    }),
  );
  service.$connect = mock.fn(async () => {
    throw new Error('connection unavailable');
  });
  await assert.rejects(service.onModuleInit(), /connection unavailable/);
});

test('Prisma rejects missing or blank connection configuration', () => {
  assert.throws(() => new PrismaService(new ConfigService()), /DATABASE_URL/);
  assert.throws(
    () => new PrismaService(new ConfigService({ DATABASE_URL: '' })),
    /DATABASE_URL/,
  );
});

test('database session options force UTC after caller options without dropping other settings', () => {
  const url = new URL(
    utcConnectionString(
      'postgresql://localhost/test?options=-c%20statement_timeout%3D5000%20-c%20timezone%3DEurope%2FIstanbul',
    ),
  );
  assert.equal(
    url.searchParams.get('options'),
    '-c statement_timeout=5000 -c timezone=Europe/Istanbul -c timezone=UTC',
  );
});
