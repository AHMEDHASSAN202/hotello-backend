import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SLUG_REGEX } from '../hotels.constants';

export class OnboardHotelProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameAr: string;

  @Matches(SLUG_REGEX, {
    message:
      'Slug must be lowercase kebab-case (a-z, 0-9, hyphens), 3–40 characters',
  })
  slug: string;

  @IsEmail()
  contactEmail: string;

  @IsString()
  @IsNotEmpty()
  contactPhone: string;

  @IsString()
  @IsNotEmpty()
  city: string;

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
  starRating?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  roomsCount?: number;
}

export class OnboardHotelPlanDto {
  @IsUUID()
  planId: string;

  /** Required for paid plans; ignored for the trial (stored as monthly). */
  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  billingCycle?: 'monthly' | 'yearly';
}

export class OnboardHotelOwnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEmail()
  email: string;
}

export class OnboardHotelDto {
  @ValidateNested()
  @Type(() => OnboardHotelProfileDto)
  profile: OnboardHotelProfileDto;

  @ValidateNested()
  @Type(() => OnboardHotelPlanDto)
  plan: OnboardHotelPlanDto;

  @ValidateNested()
  @Type(() => OnboardHotelOwnerDto)
  owner: OnboardHotelOwnerDto;
}
