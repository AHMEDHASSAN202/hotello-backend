import { IsISO8601, IsOptional } from 'class-validator';

/** Spec note 4 — delta polling: only rows changed after this instant. */
export class ListGuestRequestsQueryDto {
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
