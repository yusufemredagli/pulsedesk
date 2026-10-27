import { ResourceVersionDto } from '../../common/resource-edit';
import { PageQuery } from '../../common/pagination.dto';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { TicketPriority } from '../../generated/prisma/client';
import { optional, trim } from '../../common/pagination.dto';
export class CreatePolicyDto {
  @Transform(trim) @IsString() @Length(1, 100) name!: string;
  @IsEnum(TicketPriority) priority!: TicketPriority;
  @IsInt() @Min(1) @Max(525600) firstResponseMinutes!: number;
  @IsInt() @Min(1) @Max(525600) resolutionMinutes!: number;
  @IsBoolean() isActive: boolean = true;
}
export class UpdatePolicyDto extends ResourceVersionDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;
  @ValidateIf(optional) @IsEnum(TicketPriority) priority?: TicketPriority;
  @ValidateIf(optional)
  @IsInt()
  @Min(1)
  @Max(525600)
  firstResponseMinutes?: number;
  @ValidateIf(optional)
  @IsInt()
  @Min(1)
  @Max(525600)
  resolutionMinutes?: number;
  @ValidateIf(optional) @IsBoolean() isActive?: boolean;
}

export class PolicyQuery extends PageQuery {
  @ValidateIf(optional) @IsEnum(TicketPriority) priority?: TicketPriority;
}
