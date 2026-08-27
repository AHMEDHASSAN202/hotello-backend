import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  FnbNamesOptionalDto,
  FnbNamesRequiredDto,
} from '../../fnb/dto/fnb-name-fields.dto';
import { FnbWindowDto } from '../../fnb/dto/fnb-menu.dto';
import {
  HOTEL_INFO_MAX_WINDOWS,
  HotelInfoSection,
  REPEATABLE_SECTIONS,
} from '../hotel-info.constants';

/**
 * Epic 17, Story 17.1 — DTOs. Names/descriptions reuse the flat 7-language
 * F&B field pattern (ar + en required on create, EN fallback elsewhere).
 * Section-specific auxiliary text (location note / how-to / price note) uses
 * the same flat per-locale convention; the service rejects fields sent to
 * the wrong section (HOTEL_INFO_FIELD_INVALID).
 */

/** Essentials singleton (AC1) — plain strings, no phone-format enforcement. */
export class UpsertEssentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wifiName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  wifiPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  receptionPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  emergencyPhone?: string;
}

/** About singleton (AC1) — paragraphs-only text block, 7-locale. */
export class UpsertAboutDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionDe?: string;
}

export class CreateInfoEntryDto extends FnbNamesRequiredDto {
  @IsIn(REPEATABLE_SECTIONS)
  section: HotelInfoSection;

  // facilities — "Building B, floor 2"
  @IsOptional() @IsString() @MaxLength(300) locationNoteEn?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteAr?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteRu?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteFr?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteIt?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteEs?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteDe?: string;

  // services — how to get it
  @IsOptional() @IsString() @MaxLength(300) howToEn?: string;
  @IsOptional() @IsString() @MaxLength(300) howToAr?: string;
  @IsOptional() @IsString() @MaxLength(300) howToRu?: string;
  @IsOptional() @IsString() @MaxLength(300) howToFr?: string;
  @IsOptional() @IsString() @MaxLength(300) howToIt?: string;
  @IsOptional() @IsString() @MaxLength(300) howToEs?: string;
  @IsOptional() @IsString() @MaxLength(300) howToDe?: string;

  // services — optional price note
  @IsOptional() @IsString() @MaxLength(300) priceNoteEn?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteAr?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteRu?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteFr?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteIt?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteEs?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteDe?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HOTEL_INFO_MAX_WINDOWS)
  @ValidateNested({ each: true })
  @Type(() => FnbWindowDto)
  windows?: FnbWindowDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInfoEntryDto extends FnbNamesOptionalDto {
  // facilities — "Building B, floor 2"
  @IsOptional() @IsString() @MaxLength(300) locationNoteEn?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteAr?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteRu?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteFr?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteIt?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteEs?: string;
  @IsOptional() @IsString() @MaxLength(300) locationNoteDe?: string;

  // services — how to get it
  @IsOptional() @IsString() @MaxLength(300) howToEn?: string;
  @IsOptional() @IsString() @MaxLength(300) howToAr?: string;
  @IsOptional() @IsString() @MaxLength(300) howToRu?: string;
  @IsOptional() @IsString() @MaxLength(300) howToFr?: string;
  @IsOptional() @IsString() @MaxLength(300) howToIt?: string;
  @IsOptional() @IsString() @MaxLength(300) howToEs?: string;
  @IsOptional() @IsString() @MaxLength(300) howToDe?: string;

  // services — optional price note
  @IsOptional() @IsString() @MaxLength(300) priceNoteEn?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteAr?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteRu?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteFr?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteIt?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteEs?: string;
  @IsOptional() @IsString() @MaxLength(300) priceNoteDe?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HOTEL_INFO_MAX_WINDOWS)
  @ValidateNested({ each: true })
  @Type(() => FnbWindowDto)
  windows?: FnbWindowDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderInfoEntriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  entryIds: string[];
}
