import { SetMetadata } from '@nestjs/common';

export const GUEST_SCOPE_KEY = 'isGuestScope';

/**
 * Marks a route as guest-session-scoped (Epic 13, Story 13.5): the global
 * JwtAuthGuard authenticates it with the `guest-jwt` strategy — the third,
 * never-crossing auth universe beside platform admins and tenant users.
 */
export const GuestScope = () => SetMetadata(GUEST_SCOPE_KEY, true);
