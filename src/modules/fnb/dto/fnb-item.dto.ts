import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { STAY_TYPES, StayType } from '../../tenant-stays/stays.constants';
import { FNB_MAX_VARIANT_OPTIONS } from '../fnb.constants';
import { FnbNamesOptionalDto, FnbNamesRequiredDto } from './fnb-name-fields.dto';

export class FnbVariantOptionDto extends FnbNamesRequiredDto {
  /** Absolute price for this option ("Medium 80 / Large 110" — 16.2 AC4). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  price: number;
}

export class FnbVariantDto extends FnbNamesRequiredDto {
  // The inherited name fields ARE the group label ("Size" / "الحجم").
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FNB_MAX_VARIANT_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => FnbVariantOptionDto)
  options: FnbVariantOptionDto[];
}

/**
 * 16.2 AC2–AC5 — an item: price, pricing mode (`includedFor` null = inherit
 * menu default, [] = always paid, non-empty = included for those types),
 * one optional variant group, notes toggle.
 */
export class CreateFnbItemDto extends FnbNamesRequiredDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  price: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @IsIn(STAY_TYPES as unknown as string[], { each: true })
  includedFor?: StayType[] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => FnbVariantDto)
  variant?: FnbVariantDto | null;

  @IsOptional()
  @IsBoolean()
  allowNotes?: boolean;

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

export class UpdateFnbItemDto extends FnbNamesOptionalDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  price?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @IsIn(STAY_TYPES as unknown as string[], { each: true })
  includedFor?: StayType[] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => FnbVariantDto)
  variant?: FnbVariantDto | null;

  @IsOptional()
  @IsBoolean()
  allowNotes?: boolean;

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
