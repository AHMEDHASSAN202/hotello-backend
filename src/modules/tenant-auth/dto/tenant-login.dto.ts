import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class TenantLoginDto {
  /** The hotel slug resolved from the tenant URL — scopes the login (8.3 AC1). */
  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
