import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { validationFor } from '../../common/validation';
import { NotificationQuery } from './notifications.dto';
import { NotificationsService } from './notifications.service';
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly service: NotificationsService,
  ) {}
  @Get()
  @OrganizationAccess()
  list(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(NotificationQuery)) query: NotificationQuery,
  ) {
    return this.service.list(context, query);
  }
  @Patch(':id/read')
  @OrganizationAccess()
  read(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.read(context, id);
  }
}
