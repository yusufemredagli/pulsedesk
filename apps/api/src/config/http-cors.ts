import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { allowedFrontendOrigins } from './realtime';
export function configureHttpCors(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.enableCors({
    origin: allowedFrontendOrigins({
      FRONTEND_ORIGINS: config.get('FRONTEND_ORIGINS'),
      NODE_ENV: config.get('NODE_ENV'),
    }),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });
}
