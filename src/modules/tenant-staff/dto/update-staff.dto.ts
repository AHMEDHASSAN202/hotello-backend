import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Story 9.4 AC1 — only name and role are editable. Email is the immutable
 * identity anchor (disable + re-invite for a new address), so it is not a field
 * here.
 */
export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;
}
