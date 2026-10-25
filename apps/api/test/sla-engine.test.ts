import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  DelayedError,
  UnrecoverableError,
  type Job,
  type Worker,
} from 'bullmq';
import { deadline } from '../src/modules/sla/sla.service';
import { validateInfrastructure } from '../src/config/infrastructure';
import {
  redisOptions,
  RedisService,
} from '../src/infrastructure/redis/redis.service';
import {
  jobId,
  SLA_JOBS,
  type SlaJobData,
} from '../src/infrastructure/queue/sla-queue.service';
import {
  retryDelay,
  OutboxDispatcher,
} from '../src/infrastructure/queue/outbox-dispatcher.service';
import {
  WorkerRuntime,
  validJobData,
} from '../src/worker/worker-runtime.service';
import { SlaDeadlineService } from '../src/modules/sla/sla-deadline.service';

test('SLA deadlines are deterministic UTC durations across calendar boundaries', () => {
  const start = new Date('2026-03-29T00:30:00.123Z');
  assert.equal(deadline(start, 60).toISOString(), '2026-03-29T01:30:00.123Z');
  assert.equal(deadline(start, 1440).toISOString(), '2026-03-30T00:30:00.123Z');
  assert.equal(start.toISOString(), '2026-03-29T00:30:00.123Z');
});
test('queue configuration rejects malformed settings and separates connection retry behavior', () => {
  const valid = validateInfrastructure({
    REDIS_URL: 'redis://localhost:6379/15',
  });
  assert.equal(valid.OUTBOX_POLL_INTERVAL_MS, 2000);
  assert.equal(redisOptions('redis://localhost:6379').maxRetriesPerRequest, 1);
  assert.equal(
    redisOptions('redis://localhost:6379', true).maxRetriesPerRequest,
    null,
  );
  assert.equal(redisOptions('rediss://localhost:6380/15', true).db, 15);
  for (const REDIS_URL of [
    undefined,
    '',
    'http://localhost',
    'redis://localhost/16',
    'redis://localhost/not-a-db',
  ])
    assert.throws(() => validateInfrastructure({ REDIS_URL }));
  assert.throws(() =>
    validateInfrastructure({
      REDIS_URL: 'redis://localhost',
      SLA_QUEUE_PREFIX: 'invalid:prefix',
    }),
  );
  assert.throws(() =>
    validateInfrastructure({
      REDIS_URL: 'redis://localhost',
      OUTBOX_POLL_INTERVAL_MS: 0,
    }),
  );
});
test('job identities are deterministic and payloads contain only one valid event UUID', () => {
  const id = randomUUID();
  assert.equal(jobId(id, 'SLA_EVENT_SCHEDULED'), `sla-event-${id}`);
  assert.notEqual(
    jobId(id, 'SLA_EVENT_SCHEDULED'),
    jobId(id, 'SLA_EVENT_COMPLETED'),
  );
  assert.ok(validJobData({ slaEventId: id }));
  for (const data of [
    null,
    {},
    { slaEventId: 'invalid' },
    { slaEventId: id, organizationId: id },
  ])
    assert.equal(validJobData(data), false);
  assert.equal(retryDelay(1), 1000);
  assert.equal(retryDelay(2), 2000);
  assert.equal(retryDelay(100), 300000);
});
test('early jobs are moved back to delayed instead of silently completing', async () => {
  const dueAt = new Date('2026-10-25T18:00:00Z');
  const runtime = new WorkerRuntime(
    new ConfigService(),
    {} as OutboxDispatcher,
    {
      process: async () => ({ state: 'early', dueAt }),
    } as unknown as SlaDeadlineService,
    {} as RedisService,
  );
  const move = mock.fn(async () => {});
  const job = {
    data: { slaEventId: randomUUID() },
    name: SLA_JOBS.FIRST_RESPONSE,
    moveToDelayed: move,
  } as unknown as Job<SlaJobData>;
  await assert.rejects(runtime.process(job, 'lock-token'), DelayedError);
  assert.deepEqual(move.mock.calls[0]!.arguments, [
    dueAt.getTime(),
    'lock-token',
  ]);
  await assert.rejects(
    runtime.process({
      data: {},
      name: SLA_JOBS.FIRST_RESPONSE,
    } as unknown as Job<SlaJobData>),
    UnrecoverableError,
  );
});
test('worker shutdown waits for worker close and Redis lifecycle releases its client', async () => {
  const runtime = new WorkerRuntime(
    new ConfigService(),
    {} as OutboxDispatcher,
    {} as SlaDeadlineService,
    {} as RedisService,
  );
  const close = mock.fn(async () => {});
  runtime.worker = { close } as unknown as Worker<SlaJobData>;
  await runtime.onModuleDestroy();
  assert.equal(close.mock.callCount(), 1);
  const redis = new RedisService(
    new ConfigService({ REDIS_URL: 'redis://localhost:63999' }),
  );
  redis.onApplicationShutdown();
  assert.equal(redis.client.status, 'end');
});
