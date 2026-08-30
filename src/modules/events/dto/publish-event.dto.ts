import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Story 21.3 AC1 — the publish step offers "أعلن للضيوف", default ON. The
 * service treats `announce !== false` as "yes" so an omitted body still
 * announces (the checkbox default lives here, not in the DTO's own
 * default-value transform, since `undefined` must mean "not sent" for the
 * `!== false` check to work).
 */
export class PublishEventDto {
  @IsOptional()
  @IsBoolean()
  announce?: boolean;
}
