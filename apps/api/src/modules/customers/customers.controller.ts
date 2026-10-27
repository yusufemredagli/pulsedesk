import {
  Body,
  Controller,
  Get,
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
import { MANAGERS } from '../../common/domain-transaction.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQuery,
} from './dto/customer.dto';
import { CustomersService } from './customers.service';
import { Inject } from '@nestjs/common';
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly service: CustomersService,
  ) {}
  @Post()
  @OrganizationAccess(...MANAGERS)
  create(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(CreateCustomerDto)) body: CreateCustomerDto,
  ) {
    return this.service.create(context, body);
  }
  @Get()
  @OrganizationAccess()
  list(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(CustomerQuery)) query: CustomerQuery,
  ) {
    return this.service.list(context, query);
  }
  @Get(':id')
  @OrganizationAccess()
  get(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(context, id);
  }
  @Patch(':id')
  @OrganizationAccess(...MANAGERS)
  update(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(UpdateCustomerDto)) body: UpdateCustomerDto,
  ) {
    return this.service.update(context, id, body);
  }
}
