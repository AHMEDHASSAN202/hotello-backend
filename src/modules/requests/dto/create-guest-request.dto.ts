import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** 15.2 AC3 — item pick + optional option value + optional free-text note. */
export class CreateGuestRequestDto {
  @IsUUID()
  itemId: string;

  /** Quantity as decimal string ('2') or time 'HH:MM' — validated per item. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  optionValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
