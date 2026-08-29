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
 * Story 21.2 AC2 — every field optional (only touched fields are validated
 * and applied); the service enforces the safe-edit matrix on top of this
 * (draft: everything; published: titles/descriptions/photo/capacity-increase
 * only; completed/cancelled: nothing).
 */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_TITLE_MAX)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_TITLE_MAX)
  titleAr?: string;

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

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  descriptionAr?: string;

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

  @IsOptional()
  @IsString()
  @Matches(EVENT_LOCAL_STAMP_RE)
  startAtLocal?: string;

  /** null clears the end time (open-ended event). */
  @IsOptional()
  @Matches(EVENT_LOCAL_STAMP_RE)
  endAtLocal?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_LOCATION_TEXT_MAX)
  locationText?: string;

  /** null clears the Hotel Info link. */
  @IsOptional()
  @IsUUID()
  infoEntryId?: string | null;

  /** null = unlimited attendance. */
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsArray()
  @IsIn(STAY_TYPES, { each: true })
  includedFor?: StayType[];
}
