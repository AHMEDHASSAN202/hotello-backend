import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoomTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionAr?: string;
}
