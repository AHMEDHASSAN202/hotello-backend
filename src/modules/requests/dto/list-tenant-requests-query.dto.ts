import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { REQUEST_STATUSES, RequestStatus } from '../requests.constants';

/**
 * 15.4 AC1/AC2 — board query. `tab=open` (default) returns every open
 * request (no pagination — the board shows them all); `tab=history` is
 * paginated. `updatedSince` switches to delta mode (spec note 4).
 */
export class ListTenantRequestsQueryDto {
  @IsOptional()
  @IsIn(['open', 'history'])
  tab?: 'open' | 'history' = 'open';

  @IsOptional()
  @IsISO8601()
  updatedSince?: string;

  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: RequestStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  /** '1' floats only overdue rows (server-side overdue-only filter). */
  @IsOptional()
  @IsIn(['1'])
  overdue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}
