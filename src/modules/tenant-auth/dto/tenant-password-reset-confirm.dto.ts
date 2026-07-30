import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class TenantPasswordResetConfirmDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  // Same password policy as platform admins / owner setup (Story 8.2 AC2).
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).*$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;
}
