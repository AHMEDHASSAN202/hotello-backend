import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class InviteStaffDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsUUID()
  roleId: string;
}
