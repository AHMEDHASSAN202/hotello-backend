import { IsIn, IsOptional } from 'class-validator';

/**
 * Story 21.5 — the `GET /guest/events/bookings` tab filter. Shared with the
 * (currently filter-less) `GET /guest/events` browse query rather than a
 * second DTO file: the browse endpoint simply never reads `tab`, so the
 * field is harmlessly unused there but still validated when present.
 */
export const GUEST_BOOKING_TABS = ['upcoming', 'past', 'cancelled'] as const;
export type GuestBookingTab = (typeof GUEST_BOOKING_TABS)[number];

export class ListGuestEventsQueryDto {
  @IsOptional()
  @IsIn(GUEST_BOOKING_TABS)
  tab?: GuestBookingTab;
}
