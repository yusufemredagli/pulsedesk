import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const email = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class LoginDto {
  @Transform(email)
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(10, 128)
  password!: string;
}
export class RegisterDto extends LoginDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  organizationName!: string;
}
export class RefreshTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  refreshToken!: string;
}
