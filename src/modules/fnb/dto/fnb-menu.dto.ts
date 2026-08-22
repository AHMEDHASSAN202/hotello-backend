import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CHECKOUT_TIME_REGEX,
  STAY_TYPES,
  StayType,
} from '../../tenant-stays/stays.constants';
import { FNB_MAX_WINDOWS } from '../fnb.constants';
import { FnbNamesOptionalDto, FnbNamesRequiredDto } from './fnb-name-fields.dto';

export class FnbWindowDto {
  @Matches(CHECKOUT_TIME_REGEX, { message: 'start must be HH:MM (24-hour)' })
  start: string;

  @Matches(CHECKOUT_TIME_REGEX, { message: 'end must be HH:MM (24-hour)' })
  end: string;
}

/** 16.2 AC1 — menu with availability windows + prep SLA + pricing default. */
export class CreateFnbMenuDto extends FnbNamesRequiredDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FNB_MAX_WINDOWS)
  @ValidateNested({ each: true })
  @Type(() => FnbWindowDto)
  windows?: FnbWindowDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  prepSlaMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsIn(STAY_TYPES as unknown as string[], { each: true })
  defaultIncludedFor?: StayType[];

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

export class UpdateFnbMenuDto extends FnbNamesOptionalDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FNB_MAX_WINDOWS)
  @ValidateNested({ each: true })
  @Type(() => FnbWindowDto)
  windows?: FnbWindowDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(240)
  prepSlaMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsIn(STAY_TYPES as unknown as string[], { each: true })
  defaultIncludedFor?: StayType[];

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
