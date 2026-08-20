import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * 13.2 — `active` (default) returns the whole current-occupancy board in room
 * natural order (bounded by the hotel's room count, unpaginated); `history`
 * is paginated, newest checkout first.
 */
export class ListStaysQueryDto {
  @IsOptional()
  @IsIn(['active', 'history'])
  view?: 'active' | 'history' = 'active';

  /** Matches guest name or room number. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
