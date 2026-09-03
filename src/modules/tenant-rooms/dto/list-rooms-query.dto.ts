import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RoomStatus } from '../room.entity';

/** Story 11.2 — filters + paging for `GET /tenant/rooms`. */
export class ListRoomsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsUUID()
  typeId?: string;

  @IsOptional()
  @IsIn(['active', 'out_of_service', 'inactive'])
  status?: RoomStatus;

  @IsOptional()
  @IsString()
  search?: string;

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
  pageSize?: number = 50;

  /** Story 22.4 AC4 — only rooms whose current stay has an outstanding balance. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasBalance?: boolean;
}
