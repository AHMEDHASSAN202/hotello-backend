import { IsNotEmpty, IsString } from 'class-validator';

export class TenantPasswordResetRequestDto {
  @IsString()
  @IsNotEmpty()
  slug: string;

  /**
   * Email or username (Story 8.4 AC5). A username-shaped value (no `@`) is
   * accepted but never triggers an email — username accounts can't self-reset;
   * the response is identical either way (no account-type leak).
   */
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
