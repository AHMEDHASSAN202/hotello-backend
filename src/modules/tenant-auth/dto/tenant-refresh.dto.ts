import { IsNotEmpty, IsString } from 'class-validator';

export class TenantRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
