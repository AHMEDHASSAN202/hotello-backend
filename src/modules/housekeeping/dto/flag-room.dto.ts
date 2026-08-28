import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CLEANING_TYPES, CleaningType } from '../housekeeping.constants';

/** 20.1 AC5 — manual flag carries its type; the optional reason goes to audit. */
export class FlagRoomDto {
  @IsIn(CLEANING_TYPES)
  cleaningType: CleaningType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
