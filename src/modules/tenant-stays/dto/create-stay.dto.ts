import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GUEST_LANGUAGES, GuestLanguage } from '../stays.constants';

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Check-in form (13.1 AC1). Dates are hotel-local calendar dates. */
export class CreateStayDto {
  @IsString()
  @IsNotEmpty({ message: 'Guest name is required' })
  @MaxLength(120)
  guestName: string;

  @IsUUID()
  roomId: string;

  @Matches(ISO_DATE_REGEX, { message: 'checkInDate must be YYYY-MM-DD' })
  checkInDate: string;

  @Matches(ISO_DATE_REGEX, { message: 'checkOutDate must be YYYY-MM-DD' })
  checkOutDate: string;

  @IsIn(GUEST_LANGUAGES as unknown as string[])
  language: GuestLanguage;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guestsCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
