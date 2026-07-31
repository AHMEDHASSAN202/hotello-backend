import { SetMetadata } from '@nestjs/common';

export const PASSWORD_CHANGE_EXEMPT_KEY = 'passwordChangeExempt';

/**
 * Exempts a tenant route from the forced-password-change gate (Story 9.7 AC4).
 * The change-password endpoint, the /tenant/me bootstrap and the auth routes
 * must stay reachable while `mustChangePassword` is true — otherwise the user
 * could never clear the flag. Mirrors @SubscriptionExempt().
 */
export const PasswordChangeExempt = () =>
  SetMetadata(PASSWORD_CHANGE_EXEMPT_KEY, true);
