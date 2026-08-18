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
 * Story 11.3 AC1 — `POST /tenant/rooms`. `roomNumber` is validated raw here;
 * the service normalizes (`trim().toUpperCase()`) before save/compare.
 */
export class CreateRoomDto {
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
