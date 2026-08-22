import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FnbNamesOptionalDto, FnbNamesRequiredDto } from './fnb-name-fields.dto';

/** 16.2 AC2 — bilingual+ section names (Starters, Mains, Drinks…). */
export class CreateFnbSectionDto extends FnbNamesRequiredDto {
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

export class UpdateFnbSectionDto extends FnbNamesOptionalDto {
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
