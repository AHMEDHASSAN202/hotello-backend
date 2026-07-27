import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { HOTEL_SORT_FIELDS, HOTEL_STATUSES } from '../hotels.constants';
import type { HotelSortField, HotelStatus } from '../hotels.constants';

const SUBSCRIPTION_STATUSES = [
  'active',
  'trial',
  'past_due',
  'canceled',
  'expired',
] as const;

export class ListHotelsQueryDto {
  /** Matches name (EN/AR) or slug. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(HOTEL_STATUSES)
  status?: HotelStatus;

  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus?: (typeof SUBSCRIPTION_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsIn(HOTEL_SORT_FIELDS)
  sortBy?: HotelSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
