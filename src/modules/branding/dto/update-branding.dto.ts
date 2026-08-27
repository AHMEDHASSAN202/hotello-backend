import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { WELCOME_MAX_LENGTH } from '../branding.constants';

/** Empty string = reset the accent to the GXP default. */
const ACCENT_RE = /^$|^#[0-9a-fA-F]{6}$/;

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @Matches(ACCENT_RE, { message: 'brandAccentColor must be a #RRGGBB hex color' })
  brandAccentColor?: string;

  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeAr?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeEn?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeRu?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeFr?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeIt?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeEs?: string;
  @IsOptional() @IsString() @MaxLength(WELCOME_MAX_LENGTH) welcomeDe?: string;
}
