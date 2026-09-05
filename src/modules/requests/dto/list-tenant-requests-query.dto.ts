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
import { ASSIGNEE_FILTERS, AssigneeFilter } from '../../../common/lanes';
import { REQUEST_STATUSES, RequestStatus } from '../requests.constants';

/**
 * 15.4 AC1/AC2 — board query. `tab=open` (default) returns the FULL open
 * set (no pagination, no server-side filters — the board shows them all;
 * the tenant UI filters client-side in board-core, and filtering the
 * `updatedSince` delta stream would leave stale cards when a row exits the
 * filter set). `tab=history` is paginated and applies `status`,
 * `categoryId`, `floor`, `assigneeId` server-side. `updatedSince` switches
 * the open tab to delta mode (spec note 4).
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

  /**
   * Epic 26 (26.2 AC3) — the Staff PWA's two-lane filter, relative to the
   * caller: `me` (assigned to me), `unassigned`, or both. Open tab only
   * (ignored on history). Rows come back stamped with `lane`; in delta mode
   * rows that left the requested lanes return as reasoned tombstones.
   */
  @IsOptional()
  @IsIn(ASSIGNEE_FILTERS)
  assignee?: AssigneeFilter;

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
