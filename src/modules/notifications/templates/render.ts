import { REDACTION_MASK } from '../../mail/mail.interface';
import {
  NotificationLanguage,
  NotificationType,
} from '../notifications.constants';
import { hotelReactivatedTemplate } from './hotel-reactivated.template';
import { hotelSuspendedTemplate } from './hotel-suspended.template';
import { baseLayout } from './layout';
import { ownerSetupLinkTemplate } from './owner-setup-link.template';
import { staffInviteTemplate } from './staff-invite.template';
import { staffWelcomeTemplate } from './staff-welcome.template';
import { tenantPasswordResetTemplate } from './tenant-password-reset.template';
import { NotificationTemplate } from './template.types';
import { trialCountdownTemplate } from './trial-countdown.template';
import { trialExpiredTemplate } from './trial-expired.template';

/**
 * Story 6.3 AC5 — a missing variable fails loudly at render time; the caller
 * marks the outbox row `failed`. A half-rendered email is never sent.
 */
export class MissingTemplateVariableError extends Error {
  constructor(type: NotificationType, missing: string[]) {
    super(
      `Template '${type}' is missing required variable(s): ${missing.join(', ')}`,
    );
    this.name = 'MissingTemplateVariableError';
  }
}

const REGISTRY: Record<NotificationType, NotificationTemplate<any>> = {
  owner_setup_link: ownerSetupLinkTemplate,
  staff_invite: staffInviteTemplate,
  staff_welcome: staffWelcomeTemplate,
  tenant_password_reset: tenantPasswordResetTemplate,
  trial_countdown: trialCountdownTemplate,
  trial_expired: trialExpiredTemplate,
  hotel_suspended: hotelSuspendedTemplate,
  hotel_reactivated: hotelReactivatedTemplate,
};

export interface RenderedNotification {
  subject: string;
  html: string;
}

/**
 * Story 6.4 AC2 — the one place that renders a setup-link email twice:
 * the *masked* render is what gets persisted/logged, the *real* render
 * exists only in the caller's stack and goes straight to the driver.
 * Both the first send (listener) and the retry path (service) use this,
 * so the pairing can never drift between them.
 */
export function renderSetupLinkEmail(
  language: NotificationLanguage,
  vars: Record<string, unknown>,
  buildUrl: (token: string) => string,
  rawToken: string,
): {
  masked: RenderedNotification;
  real: RenderedNotification;
  redact: string[];
} {
  const masked = renderNotification('owner_setup_link', language, {
    ...vars,
    setupUrl: buildUrl(REDACTION_MASK),
  });
  const real = renderNotification('owner_setup_link', language, {
    ...vars,
    setupUrl: buildUrl(rawToken),
  });
  return { masked, real, redact: [rawToken] };
}

/**
 * The staff-invite twin of renderSetupLinkEmail (Epic 09): the masked render is
 * persisted/logged, the real one carries the raw token straight to the driver.
 */
export function renderStaffInviteEmail(
  language: NotificationLanguage,
  vars: Record<string, unknown>,
  buildUrl: (token: string) => string,
  rawToken: string,
): {
  masked: RenderedNotification;
  real: RenderedNotification;
  redact: string[];
} {
  const masked = renderNotification('staff_invite', language, {
    ...vars,
    setupUrl: buildUrl(REDACTION_MASK),
  });
  const real = renderNotification('staff_invite', language, {
    ...vars,
    setupUrl: buildUrl(rawToken),
  });
  return { masked, real, redact: [rawToken] };
}

/**
 * The reset-link twin of renderSetupLinkEmail (Story 8.4): the masked render is
 * persisted/logged, the real one carries the raw token straight to the driver.
 */
export function renderResetLinkEmail(
  language: NotificationLanguage,
  vars: Record<string, unknown>,
  buildUrl: (token: string) => string,
  rawToken: string,
): {
  masked: RenderedNotification;
  real: RenderedNotification;
  redact: string[];
} {
  const masked = renderNotification('tenant_password_reset', language, {
    ...vars,
    resetLink: buildUrl(REDACTION_MASK),
  });
  const real = renderNotification('tenant_password_reset', language, {
    ...vars,
    resetLink: buildUrl(rawToken),
  });
  return { masked, real, redact: [rawToken] };
}

/** Locale-aware display dates for template variables. */
export function formatNotificationDate(
  date: Date,
  language: NotificationLanguage,
  withTime = false,
): string {
  return new Intl.DateTimeFormat(
    language === 'ar' ? 'ar-EG' : 'en-GB',
    withTime
      ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }
      : { dateStyle: 'medium', timeZone: 'UTC' },
  ).format(date);
}

export function renderNotification(
  type: NotificationType,
  language: NotificationLanguage,
  vars: Record<string, unknown>,
): RenderedNotification {
  const template = REGISTRY[type];
  const missing = template.requiredVars.filter(
    (key) => vars[key] === undefined || vars[key] === null,
  );
  if (missing.length > 0) {
    throw new MissingTemplateVariableError(type, missing);
  }
  const localized = template[language];
  const subject = localized.subject(vars);
  return {
    subject,
    html: baseLayout({ language, title: subject, contentHtml: localized.content(vars) }),
  };
}
