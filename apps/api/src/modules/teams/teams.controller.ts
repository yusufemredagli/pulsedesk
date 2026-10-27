import { ResourceVersionDto } from '../../common/resource-edit';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/context.decorator';
import { OrganizationAccess } from '../auth/decorators/organization-access.decorator';
import type { TenantContext } from '../auth/types/request-context';
import { validationFor } from '../../common/validation';
import { MANAGERS } from '../../common/domain-transaction.service';
import { PageQuery } from '../../common/pagination.dto';
import { CreateTeamDto, UpdateTeamDto, AddTeamMemberDto } from './dto/team.dto';
import { TeamsService } from './teams.service';
import { Inject } from '@nestjs/common';
@Controller('teams')
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly service: TeamsService) {}
  @Post()
  @OrganizationAccess(...MANAGERS)
  create(
    @CurrentTenant() context: TenantContext,
    @Body(validationFor(CreateTeamDto)) body: CreateTeamDto,
  ) {
    return this.service.create(context, body);
  }
  @Get()
  @OrganizationAccess()
  list(
    @CurrentTenant() context: TenantContext,
    @Query(validationFor(PageQuery)) query: PageQuery,
  ) {
    return this.service.list(context, query);
  }
  @Get(':id/members')
  @OrganizationAccess()
  members(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(validationFor(PageQuery)) query: PageQuery,
  ) {
    return this.service.members(context, id, query);
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
    @Body(validationFor(UpdateTeamDto)) body: UpdateTeamDto,
  ) {
    return this.service.update(context, id, body);
  }

  @Post(':id/members')
  @OrganizationAccess(...MANAGERS)
  addMember(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validationFor(AddTeamMemberDto)) body: AddTeamMemberDto,
  ) {
    return this.service.addMember(
      context,
      id,
      body.membershipId,
      body.expectedUpdatedAt,
    );
  }
  @Delete(':id/members/:membershipId')
  @HttpCode(204)
  @OrganizationAccess(...MANAGERS)
  removeMember(
    @CurrentTenant() context: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Query(validationFor(ResourceVersionDto)) query: ResourceVersionDto,
  ) {
    return this.service.removeMember(
      context,
      id,
      membershipId,
      query.expectedUpdatedAt,
    );
  }
}
