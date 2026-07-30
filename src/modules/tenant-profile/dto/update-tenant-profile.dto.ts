import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Story 8.7 AC1/AC2 — a tenant user may edit their own name and language.
 * Email, role and permissions are NOT accepted here (managed in Epics 09–10);
 * the global whitelisting ValidationPipe strips anything else.
 */
export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: 'ar' | 'en';
}
