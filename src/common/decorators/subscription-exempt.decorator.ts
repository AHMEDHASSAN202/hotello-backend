import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_EXEMPT_KEY = 'subscriptionExempt';

/**
 * Exempts a tenant route from read-only enforcement (Story 8.6 AC2 / note 5):
 * even when the subscription is expired, auth and own-profile routes (login,
 * logout, password reset, profile edit) must keep working.
 */
export const SubscriptionExempt = () =>
  SetMetadata(SUBSCRIPTION_EXEMPT_KEY, true);
