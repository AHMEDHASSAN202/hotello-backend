import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { STAY_TYPES, StayType } from '../../tenant-stays/stays.constants';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCAL_STAMP_RE,
  EVENT_LOCATION_TEXT_MAX,
  EVENT_TITLE_MAX,
} from '../events.constants';

/**
 * Story 21.2 AC1 — flat 7-language title/description fields (the
 * Announcements/F&B convention); ar + en required, the other 5 optional.
 */
export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_TITLE_MAX)
  titleEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_TITLE_MAX)
  titleAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  titleRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  titleFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  titleIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  titleEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  titleDe?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionDe?: string;

  @IsString()
  @Matches(EVENT_LOCAL_STAMP_RE)
  startAtLocal: string;

  @IsOptional()
  @IsString()
  @Matches(EVENT_LOCAL_STAMP_RE)
  endAtLocal?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_LOCATION_TEXT_MAX)
  locationText: string;

  /** Optional "details in Hotel Info" deep-link chip (the Announcements precedent). */
  @IsOptional()
  @IsUUID()
  infoEntryId?: string;

  /** Null/omitted = unlimited attendance. */
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  /** Positive-or-zero — 0 is a legitimate "free event" price. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsArray()
  @IsIn(STAY_TYPES, { each: true })
  includedFor?: StayType[];
}
