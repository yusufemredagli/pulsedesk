import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { validationFor } from '../../common/validation';
import { MANAGERS, OPERATORS } from '../../common/domain-transaction.service';
import {
  AssignTicketDto,
  CancelTicketDto,
  CreateCommentDto,
  CreateTicketDto,
  TicketQuery,
  TransitionDto,
} from './dto/ticket.dto';
import { TicketsService } from './tickets.service';
@Controller('tickets')
export class TicketsController {
  constructor(
    @Inject(TicketsService) private readonly service: TicketsService,
  ) {}
  @Post()
  @OrganizationAccess(...OPERATORS)
  create(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(CreateTicketDto)) body: CreateTicketDto,
  ) {
    return this.service.create(context, body);
  }
  @Get()
  @OrganizationAccess()
  list(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(TicketQuery)) query: TicketQuery,
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
  @Post(':id/assign')
  @HttpCode(200)
  @OrganizationAccess(...MANAGERS)
  assign(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(AssignTicketDto)) body: AssignTicketDto,
  ) {
    return this.service.assign(context, id, body);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @OrganizationAccess(...MANAGERS)
  cancel(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(CancelTicketDto)) body: CancelTicketDto,
  ) {
    return this.service.cancel(context, id, body);
  }
  @Post(':id/comments')
  @OrganizationAccess(...OPERATORS)
  comment(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(CreateCommentDto)) body: CreateCommentDto,
  ) {
    return this.service.comment(context, id, body);
  }
  @Post(':id/triage')
  @HttpCode(200)
  @OrganizationAccess(...MANAGERS)
  triage(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'triage', body);
  }
  @Post(':id/start')
  @HttpCode(200)
  @OrganizationAccess(...OPERATORS)
  start(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'start', body);
  }
  @Post(':id/wait-for-customer')
  @HttpCode(200)
  @OrganizationAccess(...OPERATORS)
  wait_for_customer(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'wait-for-customer', body);
  }
  @Post(':id/resume')
  @HttpCode(200)
  @OrganizationAccess(...OPERATORS)
  resume(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'resume', body);
  }
  @Post(':id/resolve')
  @HttpCode(200)
  @OrganizationAccess(...OPERATORS)
  resolve(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'resolve', body);
  }
  @Post(':id/close')
  @HttpCode(200)
  @OrganizationAccess(...MANAGERS)
  close(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(TransitionDto)) body: TransitionDto,
  ) {
    return this.service.transition(context, id, 'close', body);
  }
}
