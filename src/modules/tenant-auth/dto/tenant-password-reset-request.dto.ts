import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class TenantPasswordResetRequestDto {
  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsEmail()
  email: string;
}
