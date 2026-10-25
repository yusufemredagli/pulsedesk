import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
const messages: Record<number, string> = {
  400: 'Invalid request',
  401: 'Invalid authentication credentials',
  403: 'Access denied',
  404: 'Not found',
  409: 'Resource conflict',
  413: 'Request body too large',
  429: 'Too many requests',
  503: 'Dependencies unavailable',
};
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (statusCode >= 500) this.logger.error('Unhandled request failure');
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (statusCode === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(statusCode).json({
      statusCode,
      message: messages[statusCode] ?? 'Internal server error',
    });
  }
}
