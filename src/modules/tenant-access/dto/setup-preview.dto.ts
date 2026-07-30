import { IsNotEmpty, IsString } from 'class-validator';

export class SetupPreviewDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
