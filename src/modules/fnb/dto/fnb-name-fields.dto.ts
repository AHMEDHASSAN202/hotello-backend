import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Flat 7-language name/description fields (Epic 15 custom-item pattern).
 * Create DTOs extend the Required variant (ar + en mandatory); update DTOs
 * extend the Optional variant (only what changes is sent).
 */
export class FnbNamesRequiredDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameEn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameAr: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameDe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionDe?: string;
}

export class FnbNamesOptionalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameDe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionFr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionIt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionEs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionDe?: string;
}
