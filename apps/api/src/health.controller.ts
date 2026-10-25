import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@pulsedesk/shared';
@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return { status: 'ok', service: 'pulsedesk-api' };
  }
}
