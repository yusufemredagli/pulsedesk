import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateIf,
  IsIn,
  IsBoolean,
} from 'class-validator';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
  CommentVisibility,
} from '../../../generated/prisma/client';
import { PageQuery, optional, trim } from '../../../common/pagination.dto';
export class CreateTicketDto {
  @IsUUID() customerId!: string;
  @Transform(trim) @IsString() @Length(1, 200) subject!: string;
  @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @ValidateIf(optional) @IsEnum(TicketPriority) priority: TicketPriority =
    'MEDIUM';
  @ValidateIf(optional) @IsEnum(TicketSource) source: TicketSource = 'WEB';
}
export class TicketQuery extends PageQuery {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  activeOnly?: boolean;
  @ValidateIf(optional) @IsEnum(TicketStatus) status?: TicketStatus;
  @ValidateIf(optional) @IsEnum(TicketPriority) priority?: TicketPriority;
  @ValidateIf(optional) @IsUUID() customerId?: string;
  @ValidateIf(optional) @IsUUID() assignedTeamId?: string;
  @ValidateIf(optional) @IsUUID() assignedMemberId?: string;
  @IsIn([
    'createdAt:desc',
    'createdAt:asc',
    'updatedAt:desc',
    'updatedAt:asc',
    'ticketNumber:desc',
    'ticketNumber:asc',
    'priority:desc',
    'priority:asc',
  ])
  sort: string = 'createdAt:desc';
}
export class VersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class TransitionDto extends VersionDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
export class CancelTicketDto extends VersionDto {
  @Transform(trim) @IsString() @Length(1, 1000) reason!: string;
}
export class AssignTicketDto extends VersionDto {
  @ValidateIf(optional) @IsUUID() assignedMemberId?: string;
  @ValidateIf(optional) @IsUUID() assignedTeamId?: string;
}
export class CreateCommentDto {
  @Transform(trim) @IsString() @Length(1, 10000) body!: string;
  @IsEnum(CommentVisibility) visibility: CommentVisibility = 'INTERNAL';
}
