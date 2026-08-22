import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REQUEST_OPTION_TYPES, RequestOptionType } from '../requests.constants';

/**
 * 15.1 AC2 — `enabled`/`slaMinutes` curate ANY item (per-hotel settings
 * upsert). Every other field is CONTENT and only valid on the hotel's own
 * custom items — platform translations are read-only (403 CUSTOM_ITEM_ONLY).
 */
export class UpdateCatalogItemDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  slaMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameAr?: string;

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
  optionType?: RequestOptionType | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  optionMin?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  optionMax?: number | null;
}
