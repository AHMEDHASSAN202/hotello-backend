import { IsNotEmpty, IsString } from 'class-validator';

export class TenantLoginDto {
  /** The hotel slug resolved from the tenant URL — scopes the login (8.3 AC1). */
  @IsString()
  @IsNotEmpty()
  slug: string;

  /**
   * Email or username (Story 8.3 AC1). Input containing `@` is treated as an
   * email, otherwise as a username. Not `@IsEmail()` — usernames are valid.
   */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
