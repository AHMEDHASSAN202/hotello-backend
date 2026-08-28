import { IsISO8601, IsOptional } from 'class-validator';

/**
 * 20.2 AC1 — the board is unpaginated (every room, floor-grouped);
 * `updatedSince` switches to delta mode (cursor = previous serverTime).
 * Filters are client-side — the whole hotel fits in one payload.
 */
export class ListBoardQueryDto {
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
