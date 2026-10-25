import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
bootstrap().catch(() => {
  console.error(
    'SLA worker startup failed; check infrastructure configuration',
  );
  process.exitCode = 1;
});
