import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { STAY_CODE_REGEX } from '../../tenant-stays/stays.constants';

/**
 * 13.5 AC1 — entry body. `roomNumber` comes from the `?room=` URL param when
 * present or from user input (banner flow). camelCase like every API body
 * (recorded decision — the spec's `room_number` was pseudocode).
 */
export class GuestSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  roomNumber: string;

  @Matches(STAY_CODE_REGEX, { message: 'Code must be six digits' })
  code: string;
}
