import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  GUEST_LANGUAGES,
  GuestLanguage,
  STAY_TYPES,
  StayType,
} from '../stays.constants';
import { ISO_DATE_REGEX } from './create-stay.dto';

/**
 * 13.3 AC1 (extend/shorten) + AC5 (guest info). All fields optional — only
 * what changes is sent. `email`/`phone`/`guestsCount`/`note` accept null to
 * clear the value.
 */
export class UpdateStayDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Guest name is required' })
  @MaxLength(120)
  guestName?: string;

  @IsOptional()
  @Matches(ISO_DATE_REGEX, { message: 'checkOutDate must be YYYY-MM-DD' })
  checkOutDate?: string;

  @IsOptional()
  @IsIn(GUEST_LANGUAGES as unknown as string[])
  language?: GuestLanguage;

  /** 16.1 AC1 — editable later; lands in the stay.updated audit diff. */
  @IsOptional()
  @IsIn(STAY_TYPES as unknown as string[])
  stayType?: StayType;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guestsCount?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
