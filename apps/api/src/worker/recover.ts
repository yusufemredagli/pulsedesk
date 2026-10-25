import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { once } from 'node:events';
import { isUUID } from 'class-validator';
import { WorkerInfrastructureModule } from './worker-infrastructure.module';
import { OutboxDispatcher } from '../infrastructure/queue/outbox-dispatcher.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { QueueRecovery } from './queue-recovery.service';
@Module({
  imports: [WorkerInfrastructureModule],
  providers: [OutboxDispatcher, QueueRecovery],
})
class RecoveryModule {}
async function recover() {
  const mode = process.argv[2] ?? 'retry-failed';
  const after = process.argv[3] ?? null;
  if (!['retry-failed', 'replay'].includes(mode) || (after && !isUUID(after)))
    throw new Error('Invalid recovery arguments');
  const app = await NestFactory.createApplicationContext(RecoveryModule, {
    logger: false,
  });
  app.enableShutdownHooks();
  try {
    const redis = app.get(RedisService);
    if (redis.client.status !== 'ready')
      await once(redis.client, 'ready', { signal: AbortSignal.timeout(3000) });
    const recovery = app.get(QueueRecovery);
    console.log(
      JSON.stringify(
        mode === 'replay'
          ? await recovery.replay(after)
          : await recovery.retryFailed(),
      ),
    );
  } finally {
    await app.close();
  }
}
recover().catch(() => {
  console.error('Queue recovery failed; verify infrastructure and arguments');
  process.exitCode = 1;
});
