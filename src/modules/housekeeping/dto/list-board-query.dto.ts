import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { AssigneeFilter, ASSIGNEE_FILTERS } from '../../../common/lanes';

/**
 * 20.2 AC1 — the board is unpaginated (every room, floor-grouped);
 * `updatedSince` switches to delta mode (cursor = previous serverTime).
 * Filters are client-side — the whole hotel fits in one payload.
 */
export class ListBoardQueryDto {
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;

  /** Epic 26 (26.2 AC3) — Staff PWA two-lane filter; see common/lanes.ts. */
  @IsOptional()
  @IsIn(ASSIGNEE_FILTERS)
  assignee?: AssigneeFilter;
}
