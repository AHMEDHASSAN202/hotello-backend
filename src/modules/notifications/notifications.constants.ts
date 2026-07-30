export const NOTIFICATION_TYPES = [
  'owner_setup_link',
  'staff_invite',
  'tenant_password_reset',
  'trial_countdown',
  'trial_expired',
  'hotel_suspended',
  'hotel_reactivated',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Lifecycle (Story 6.1 AC2): pending → sent | failed. */
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationLanguage = 'ar' | 'en';

/** Story 6.5 AC1 — countdown emails at 7, 3 and 1 day(s) remaining. */
export const TRIAL_THRESHOLDS = [7, 3, 1] as const;
export type TrialThreshold = (typeof TRIAL_THRESHOLDS)[number];
