import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { STAFF_CANCEL_REASONS, StaffCancelReason } from '../requests.constants';

/**
 * 15.5 AC1 — staff cancel requires a reason; `other` additionally requires a
 * note. The ValidateIf runs the note validators when the reason demands one
 * or when a note was volunteered — otherwise the field is skipped entirely.
 */
export class CancelRequestDto {
  @IsIn(STAFF_CANCEL_REASONS)
  reason: StaffCancelReason;

  @ValidateIf(
    (o: CancelRequestDto) => o.reason === 'other' || o.note !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}
