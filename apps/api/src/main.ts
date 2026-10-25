import 'reflect-metadata';
import { configureHttpCors } from './config/http-cors';
import { configureRealtime } from './modules/realtime/realtime-adapter';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  configureHttpCors(app);
  configureRealtime(app);
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}
bootstrap().catch(() => {
  console.error(
    'API startup failed; check infrastructure, authentication, and realtime configuration',
  );
  process.exitCode = 1;
});
