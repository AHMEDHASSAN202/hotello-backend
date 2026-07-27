import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  nameEn: string;

  @IsString()
  @IsNotEmpty()
  nameAr: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string | null;

  @IsOptional()
  @IsString()
  descriptionAr?: string | null;

  @IsNumber()
  @Min(0)
  monthlyPrice: number;

  /** Omit or null = yearly billing unavailable. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  yearlyPrice?: number | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  /** Positive integer, or null/omitted = unlimited. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  maxRooms?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxStaffUsers?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxGuestRequestsPerMonth?: number | null;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  enabledModules: string[];

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  trialDurationDays?: number | null;
}
