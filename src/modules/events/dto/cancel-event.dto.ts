import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EVENT_CANCEL_REASON_MAX } from '../events.constants';

/**
 * Story 21.2 AC3 — cancelling a published event requires a reason; it's
 * copied onto the event row, every cascaded booking, and the auto-composed
 * guest-facing cancellation notice.
 */
export class CancelEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_CANCEL_REASON_MAX)
  reason: string;
}
