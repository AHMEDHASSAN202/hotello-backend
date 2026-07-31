import { createHash } from 'crypto';
import { TrialThreshold } from './notifications.constants';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Story 6.1 AC4 — every dedupe key is built here so the idempotency
 * discipline lives in one place, not scattered across listener handlers.
 * A new notification type gets a builder here or it doesn't ship.
 */
export const dedupeKeys = {
  /**
   * Keyed per token issuance — a hash *prefix* of a hash that is already
   * persisted on tenant_users.setupTokenHash leaks nothing. Regeneration
   * mints a new token, hence a new key, hence a new email (6.4 AC1).
   */
  ownerSetupLink: (ownerId: string, rawToken: string): string =>
    `owner_setup_link:${ownerId}:${createHash('sha256')
      .update(rawToken)
      .digest('hex')
      .slice(0, 12)}`,

  /**
   * Keyed per invite-token issuance — a resend mints a new token, hence a new
   * key, hence a fresh email always goes out (Story 9.6 AC1).
   */
  staffInvite: (userId: string, rawToken: string): string =>
    `staff_invite:${userId}:${createHash('sha256')
      .update(rawToken)
      .digest('hex')
      .slice(0, 12)}`,

  /** One welcome email per account (9.7 AC7) — keyed on the user id. */
  staffWelcome: (userId: string): string => `staff_welcome:${userId}`,

  /** Keyed per reset-token issuance — a new request mints a new key/email. */
  tenantPasswordReset: (userId: string, rawToken: string): string =>
    `tenant_password_reset:${userId}:${createHash('sha256')
      .update(rawToken)
      .digest('hex')
      .slice(0, 12)}`,

  /**
   * The trialEndsAt date is part of the key: an extension changes the date,
   * so the 7/3/1 thresholds re-arm for the new schedule (6.5 AC4).
   */
  trialCountdown: (
    subscriptionId: string,
    threshold: TrialThreshold,
    trialEndsAt: Date,
  ): string =>
    `trial_countdown:${subscriptionId}:${threshold}:${isoDate(trialEndsAt)}`,

  trialExpired: (subscriptionId: string, trialEndsAt: Date): string =>
    `trial_expired:${subscriptionId}:${isoDate(trialEndsAt)}`,

  /** suspendedAt is the per-occurrence discriminator (6.6 AC1). */
  hotelSuspended: (hotelId: string, suspendedAt: Date): string =>
    `hotel_suspended:${hotelId}:${suspendedAt.toISOString()}`,

  hotelReactivated: (hotelId: string, occurredAt: Date): string =>
    `hotel_reactivated:${hotelId}:${occurredAt.toISOString()}`,
};
