import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_REGEX } from '../hotels.constants';

/**
 * Story 5.4 — every profile field editable; slug guarded to wildcard (*).
 * `roomsCount` is intentionally absent (11.6 AC2): it's the derived counter
 * Tasks 4–6 keep in sync from actual rooms — an admin PATCH must never
 * corrupt it. The whitelist ValidationPipe rejects the field if sent.
 */
export class UpdateHotelDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAr?: string;

  /** Immutable except for Super Admin (*) — service-enforced, audit-logged. */
  @IsOptional()
  @Matches(SLUG_REGEX, {
    message:
      'Slug must be lowercase kebab-case (a-z, 0-9, hyphens), 3–40 characters',
  })
  slug?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  defaultLanguage?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number | null;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
