import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 16.3 AC1 — a delivery location: names AR + EN, optional numbered spots
 * with a bilingual spot label. The immutable `key` is server-generated from
 * the EN name at creation and NEVER appears on the update DTO (AC4 —
 * printed QRs embed it).
 */
export class CreateFnbLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameAr: string;

  @IsOptional()
  @IsBoolean()
  hasSpots?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  spotLabelEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  spotLabelAr?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateFnbLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  hasSpots?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  spotLabelEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  spotLabelAr?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

/** 16.3 AC2 — single sticker (no range) or a numbered series (from–to). */
export class StickerPdfQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  to?: number;

  /** Comma-separated numbers to skip inside the series. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+(,\d+)*$/, { message: 'exclusions must be numbers, comma-separated' })
  exclusions?: string;
}

export class LocationQrQueryDto {
  @IsOptional()
  @IsIn(['png', 'svg'])
  format?: 'png' | 'svg';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  spot?: string;
}
