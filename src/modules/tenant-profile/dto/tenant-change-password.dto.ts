import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class TenantChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  // Same password policy as platform admins / owner setup (Story 8.7 / 8.2 AC2).
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).*$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword: string;
}
