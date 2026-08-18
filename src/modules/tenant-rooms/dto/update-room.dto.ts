import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RoomStatus } from '../room.entity';

/**
 * Story 11.4 AC1/AC2 — `PATCH /tenant/rooms/:id`. All fields optional (partial
 * update); `roomNumber` is validated raw here, the service normalizes
 * (`trim().toUpperCase()`) before save/compare and only applies it while the
 * room has no stay history (11.4 AC1).
 */
export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9-]{1,20}$/, {
    message: 'roomNumber must be letters, numbers or hyphens',
  })
  roomNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @IsOptional()
  @IsIn(['active', 'out_of_service', 'inactive'])
  status?: RoomStatus;
}
