import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_FLOOR, MIN_FLOOR } from '../../tenant-rooms/room-rows';
import { STAY_TYPES, StayType } from '../../tenant-stays/stays.constants';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  LOCAL_STAMP_RE,
} from '../announcements.constants';

/**
 * 19.1 AC2/AC3 — the audience filter as sent by the tenant UI. Empty object =
 * all current guests. Service-level rules: `stayId` is exclusive with the
 * other dimensions and must resolve to an active stay of this hotel.
 */
export class AudienceFilterDto {
  @IsOptional()
  @IsArray()
  @IsIn(STAY_TYPES, { each: true })
  stayTypes?: StayType[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(MIN_FLOOR, { each: true })
  @Max(MAX_FLOOR, { each: true })
  floors?: number[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roomIds?: string[];

  @IsOptional()
  @IsUUID()
  stayId?: string;

  /** 21.3 AC3 — event-cancel notice targets N booked stays. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  stayIds?: string[];
}

/** Flat 7-language title/body fields (19.1 AC1) + link, priority, audience. */
export class AnnouncementContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleDe?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyDe?: string;

  /** Optional "details in Hotel Info" chip target (19.1 AC1). */
  @IsOptional()
  @IsUUID()
  infoEntryId?: string;

  /** "مهم" — use sparingly (19.1 AC1; the UI carries the nudge). */
  @IsOptional()
  @IsBoolean()
  priority?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audience?: AudienceFilterDto;
}

/**
 * 19.2 AC1 — send now, schedule (hotel-local datetime) or park as a draft.
 * `publishAtLocal` is required when action is `schedule` (service rule).
 */
export class CreateAnnouncementDto extends AnnouncementContentDto {
  @IsIn(['send', 'schedule', 'draft'])
  action: 'send' | 'schedule' | 'draft';

  @IsOptional()
  @Matches(LOCAL_STAMP_RE)
  publishAtLocal?: string;

  @IsOptional()
  @Matches(LOCAL_STAMP_RE)
  activeUntilLocal?: string;
}

/** Draft/scheduled edits only (19.2 AC1/AC3); live is retract-and-resend. */
export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_TITLE_MAX)
  titleDe?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANNOUNCEMENT_BODY_MAX)
  bodyDe?: string;

  /** null clears the Hotel Info link. */
  @IsOptional()
  @IsUUID()
  infoEntryId?: string | null;

  @IsOptional()
  @IsBoolean()
  priority?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audience?: AudienceFilterDto;

  @IsOptional()
  @Matches(LOCAL_STAMP_RE)
  publishAtLocal?: string;

  /** null clears the active-until window. */
  @IsOptional()
  @Matches(LOCAL_STAMP_RE)
  activeUntilLocal?: string | null;
}

/** 19.1 AC2 — live recipient count ("سيصل إلى 62 ضيفًا حاليًا"). */
export class PreviewAudienceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  audience?: AudienceFilterDto;
}

/** Delta cursor — the previous response's serverTime (Epic 15/16 pattern). */
export class ListGuestAnnouncementsQueryDto {
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
