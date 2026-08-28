import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 20.3 AC2 — Stopped/interrupted requires the reason (kept in audit). */
export class InterruptRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
