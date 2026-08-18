import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Story 11.3 AC2 — `POST /tenant/rooms/bulk/preview` body. `from`/`to` are
 * inclusive; `expandRange` (room-rows.ts) enforces `from <= to` and the
 * 500-room cap.
 */
export class BulkPreviewDto {
  @IsInt()
  @Min(0)
  from: number;

  @IsInt()
  to: number;

  @IsOptional()
  @IsInt({ each: true })
  exclusions?: number[];

  @IsOptional()
  @IsInt()
  floor?: number;

  @IsUUID()
  roomTypeId: string;
}
