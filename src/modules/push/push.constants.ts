export const PUSH_TYPES = [
  'announcement',
  'request_status',
  'order_status',
  'event_reminder',
  'checkout_reminder',
  // Epic 26 — staff pushes (assignment + "new task available" per lane).
  'staff_assigned',
  'staff_available',
] as const;
export type PushType = (typeof PUSH_TYPES)[number];

/** `superseded` = a newer dispatch with the same collapse topic replaced this pending one. */
export const PUSH_DISPATCH_STATUSES = [
  'pending',
  'sent',
  'failed',
  'superseded',
] as const;
export type PushDispatchStatus = (typeof PUSH_DISPATCH_STATUSES)[number];
