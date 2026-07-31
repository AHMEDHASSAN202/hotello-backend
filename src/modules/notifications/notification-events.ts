import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SuspensionReason } from '../hotels/hotels.constants';
import { TrialThreshold } from './notifications.constants';

/**
 * Story 6.1 AC3 — business services emit these events; the notifications
 * module owns all listening, rendering and sending. Emitters import only the
 * constants/types from this file (no module cycle).
 */
export const NOTIFICATION_EVENTS = {
  OWNER_SETUP_LINK_REQUESTED: 'hotel.owner_setup_link_requested',
  STAFF_INVITE_REQUESTED: 'tenant_user.staff_invite_requested',
  STAFF_WELCOME_REQUESTED: 'tenant_user.staff_welcome_requested',
  TENANT_PASSWORD_RESET_REQUESTED: 'tenant_user.password_reset_requested',
  TRIAL_COUNTDOWN: 'subscription.trial_countdown',
  TRIAL_EXPIRED: 'subscription.trial_expired',
  HOTEL_SUSPENDED: 'hotel.suspended',
  HOTEL_REACTIVATED: 'hotel.reactivated',
} as const;

export interface TenantPasswordResetRequestedEvent {
  hotelId: string;
  tenantUserId: string;
  userName: string;
  userEmail: string;
  hotelNameEn: string;
  hotelNameAr: string;
  slug: string;
  /** The user's resolved language (preferredLanguage ?? hotel default). */
  language: string;
  /** In-memory only — never persisted (mirrors the setup-link secret handling). */
  rawToken: string;
  expiresAt: Date;
}

export interface StaffInviteRequestedEvent {
  hotelId: string;
  tenantUserId: string;
  userName: string;
  userEmail: string;
  roleNameEn: string;
  roleNameAr: string;
  hotelNameEn: string;
  hotelNameAr: string;
  slug: string;
  /** Hotel default language — the invitee has no preference yet (note #5). */
  language: string;
  /** In-memory only — never persisted (mirrors the setup-link secret handling). */
  rawToken: string;
  expiresAt: Date;
  /** Set by an admin resend path to link outbox lineage. */
  resendOfId?: string;
}

export interface StaffWelcomeRequestedEvent {
  hotelId: string;
  tenantUserId: string;
  userName: string;
  /** Present only when the account has an email (welcome email is email-gated). */
  userEmail: string;
  username: string;
  hotelNameEn: string;
  hotelNameAr: string;
  slug: string;
  /** Hotel default language — a fresh account has no preference yet. */
  language: string;
}

export interface OwnerSetupLinkRequestedEvent {
  hotelId: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  hotelNameEn: string;
  hotelNameAr: string;
  slug: string;
  language: string;
  /** In-memory only — never persisted (Story 6.4 AC2). */
  rawToken: string;
  expiresAt: Date;
  /** Set by the resend path (Story 6.7 AC4) to link outbox lineage. */
  resendOfId?: string;
}

export interface TrialCountdownEvent {
  subscriptionId: string;
  hotelId: string;
  /** The notice tier — drives the dedupe key, not the displayed number. */
  threshold: TrialThreshold;
  /** Actual days left — what the email shows (catch-up runs differ from the tier). */
  daysRemaining: number;
  trialEndsAt: Date;
}

export interface TrialExpiredEvent {
  subscriptionId: string;
  hotelId: string;
  trialEndsAt: Date;
}

export interface HotelSuspendedEvent {
  hotelId: string;
  /** Category only — the internal note never leaves the platform (6.6 AC1). */
  reason: SuspensionReason;
  suspendedAt: Date;
}

export interface HotelReactivatedEvent {
  hotelId: string;
  occurredAt: Date;
}

/**
 * A notification must never fail the emitting business operation (6.1 AC3).
 * Listeners already swallow their own errors; this guards emitter-side
 * failures (e.g. a broken listener registration) as well.
 *
 * Uses `emitAsync` and awaits it: `emit()` fires async listeners without
 * awaiting them, so the outbox row would race the emitter's next statement
 * (and the HTTP response). Awaiting keeps the persist-first guarantee —
 * listeners only await the outbox INSERT and dispatch the actual send in
 * the background, so provider latency never blocks the caller.
 */
export async function safeEmit(
  emitter: EventEmitter2,
  event: string,
  payload: unknown,
  logger?: Logger,
): Promise<void> {
  try {
    await emitter.emitAsync(event, payload);
  } catch (err) {
    (logger ?? new Logger('NotificationEvents')).error(
      `Failed to emit ${event}: ${err instanceof Error ? err.message : err}`,
    );
  }
}
