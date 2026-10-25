import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { validationFor } from '../../common/validation';
import { PageQuery } from '../../common/pagination.dto';
import { CreatePolicyDto, UpdatePolicyDto } from './sla-policy.dto';
import { SlaPolicyService } from './sla-policy.service';
@Controller('sla/policies')
export class SlaPolicyController {
  constructor(
    @Inject(SlaPolicyService) private readonly service: SlaPolicyService,
  ) {}
  @Get()
  @OrganizationAccess()
  list(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(PageQuery)) query: PageQuery,
  ) {
    return this.service.list(context, query);
  }
  @Post()
  @OrganizationAccess('OWNER', 'ADMIN')
  create(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(CreatePolicyDto)) body: CreatePolicyDto,
  ) {
    return this.service.create(context, body);
  }
  @Patch(':id')
  @OrganizationAccess('OWNER', 'ADMIN')
  update(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(UpdatePolicyDto)) body: UpdatePolicyDto,
  ) {
    return this.service.update(context, id, body);
  }
}
