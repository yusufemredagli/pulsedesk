import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { optional, trim } from '../../../common/pagination.dto';
const email = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class CustomerFields {
  @IsOptional() @Transform(email) @IsEmail() @MaxLength(254) email?:
    string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) phone?:
    string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 200) companyName?:
    string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) notes?:
    string | null;
}
export class CreateCustomerDto extends CustomerFields {
  @Transform(trim) @IsString() @Length(1, 200) name!: string;
}
export class UpdateCustomerDto extends CustomerFields {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;
}
