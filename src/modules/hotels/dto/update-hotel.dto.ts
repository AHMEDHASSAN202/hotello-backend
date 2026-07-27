import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_REGEX } from '../hotels.constants';

/** Story 5.4 — every profile field editable; slug guarded to wildcard (*). */
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
  @IsInt()
  @Min(0)
  roomsCount?: number;

  /** Wildcard-only override of the rooms-vs-plan-limit guard; audit-logged. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
