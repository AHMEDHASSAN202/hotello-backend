import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { RoomStatus } from '../room.entity';

/**
 * Story 11.3/11.7 — one row of `POST /tenant/rooms/bulk`. Mirrors
 * `CreateRoomDto` plus the `row` index the preview handed back, so any
 * per-row error the commit re-resolves (mid-flight duplicate, etc.) still
 * points at the right line for the UI.
 */
export class RoomRowDto {
  @IsInt()
  row: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9-]{1,20}$/, {
    message: 'roomNumber must be letters, numbers or hyphens',
  })
  roomNumber: string;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @IsUUID()
  roomTypeId: string;

  @IsOptional()
  @IsIn(['active', 'out_of_service'])
  status?: RoomStatus;
}

/** `range` echoed back only for `source: 'range'` (goes straight into the audit metadata). */
export class BulkRangeDto {
  @IsInt()
  from: number;

  @IsInt()
  to: number;
}

/**
 * Story 11.3 AC4 — `POST /tenant/rooms/bulk` body. One transaction commits
 * `rooms`; Task 11 (Excel import, Story 11.7) posts the same shape with
 * `source: 'import'`.
 */
export class BulkCommitDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RoomRowDto)
  rooms: RoomRowDto[];

  @IsIn(['range', 'import'])
  source: 'range' | 'import';

  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;

  @IsOptional()
  @IsInt()
  skippedCount?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkRangeDto)
  range?: BulkRangeDto;
}
