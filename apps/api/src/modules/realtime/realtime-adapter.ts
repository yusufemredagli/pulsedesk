import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { allowedFrontendOrigins } from '../../config/realtime';
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origins: string[],
  ) {
    super(app);
  }
  override createIOServer(port: number, options?: ServerOptions) {
    const permitted = (origin: string | undefined) =>
      origin === undefined || this.origins.includes(origin);
    const settings: Partial<ServerOptions> = {
      ...options,
      transports: ['websocket'],
      maxHttpBufferSize: 8192,
      connectTimeout: 10000,
      allowRequest: (request, callback) =>
        callback(null, permitted(request.headers.origin)),
      cors: {
        origin: (origin, callback) => callback(null, permitted(origin)),
        credentials: false,
      },
    };
    return super.createIOServer(port, settings);
  }
}
export function configureRealtime(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.useWebSocketAdapter(
    new RealtimeAdapter(
      app,
      allowedFrontendOrigins({
        FRONTEND_ORIGINS: config.get('FRONTEND_ORIGINS'),
        NODE_ENV: config.get('NODE_ENV'),
      }),
    ),
  );
}
