import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 20.1 AC5 — manual unflag; the optional reason goes to audit. */
export class ClearRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
