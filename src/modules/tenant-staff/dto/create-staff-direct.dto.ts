import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * Story 9.7 — create a staff account directly with a username and (optional)
 * temporary password. Email is optional; the CHECK constraint plus the
 * required username guarantee at least one identifier (AC3).
 */
export class CreateStaffDirectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  // Lowercase, 3–30 chars, [a-z0-9._-]; the character class rejects `@`, so a
  // username can never be mistaken for an email at login (AC2/AC3).
  @Matches(/^[a-z0-9._-]{3,30}$/, {
    message:
      'Username must be 3–30 lowercase chars (letters, numbers, . _ -), no spaces or @',
  })
  username: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsUUID()
  roleId: string;

  // Optional — generated server-side when omitted. When supplied it must meet
  // the same policy as every other password entry point.
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).*$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password?: string;

  // Only honored when an email is present (AC7).
  @IsOptional()
  @IsBoolean()
  sendWelcomeEmail?: boolean;
}
