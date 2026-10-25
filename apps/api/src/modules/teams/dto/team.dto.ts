import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { optional, trim } from '../../../common/pagination.dto';
export class CreateTeamDto {
  @Transform(trim) @IsString() @Length(1, 100) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?:
    string | null;
}
export class UpdateTeamDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?:
    string | null;
}
export class AddTeamMemberDto {
  @IsUUID() membershipId!: string;
}
