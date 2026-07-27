import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SUSPENSION_REASONS } from '../hotels.constants';
import type { SuspensionReason } from '../hotels.constants';

export class SuspendHotelDto {
  @IsIn(SUSPENSION_REASONS)
  reason: SuspensionReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
