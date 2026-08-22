import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REQUEST_OPTION_TYPES, RequestOptionType } from '../requests.constants';

/**
 * 15.1 AC4 — a hotel's custom item: AR + EN required, the other five
 * languages optional (guests fall back to EN per field). SLA required.
 */
export class CreateCustomItemDto {
  @IsUUID()
  categoryId: string;

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
  @MaxLength(80)
  nameRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameDe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  descriptionDe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsIn(REQUEST_OPTION_TYPES)
  optionType?: RequestOptionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  optionMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  optionMax?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  slaMinutes: number;
}
