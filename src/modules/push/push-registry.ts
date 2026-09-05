import { GuestLanguage } from '../tenant-stays/stays.constants';
import { TranslationMap, localizeField } from '../requests/requests.constants';
import { PushType } from './push.constants';
import {
  OrderStatusPushKey,
  ORDER_STATUS_LINES,
  RequestStatusPushKey,
  REQUEST_STATUS_LINES,
  StaffPushVars,
  STAFF_PUSH_LINES,
  composeCheckoutReminder,
  composeEventReminder,
  staffLang,
} from './push-copy';

export interface ComposedPush {
  title: string;
  body: string;
  url: string;
}

export interface PushTypeSpec {
  ttlSeconds: number;
  quietHours: boolean;
  /** Collapse topic from the source id and/or compose vars, or null for no collapse. */
  topic: (refId: string | null, vars: Record<string, unknown>) => string | null;
  compose: (language: GuestLanguage, vars: Record<string, unknown>) => ComposedPush;
}

/** uuid → 32-char base64url-safe topic (hex, dashes stripped), or null when there's no id to collapse on. */
const uuidTopic = (refId: string | null) => (refId ? refId.replace(/-/g, '').slice(0, 32) : null);

const BODY_MAX = 160; // push bodies are glanceable; announcement bodies get truncated
const clip = (s: string) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX - 1)}…` : s);

/** 26.4 AC5 — relative deep link, resolved against the staff PWA's own origin. */
const staffUrl = (slug: string, v: StaffPushVars) =>
  v.id ? `/t/${slug}?open=${v.feed}:${v.id}` : `/t/${slug}?open=${v.feed}`;

/**
 * THE type registry (spec note 4): adding a new push (e.g. Laundry's
 * "غسيلك جاهز ✨") = one entry here + one `pushService.notify()` line at the
 * emitting transition. Nothing else — no new tables, controllers, or SW work.
 */
export const PUSH_REGISTRY: Record<PushType, PushTypeSpec> = {
  announcement: {
    ttlSeconds: 6 * 3600, // 23.1 AC4 — announcements longer-lived
    quietHours: true, // 23.3 AC4 (priority bypasses at notify() level)
    topic: uuidTopic, // resend of same announcement collapses
    compose: (lang, vars) => ({
      title: localizeField(vars.titles as TranslationMap, lang),
      body: clip(localizeField(vars.bodies as TranslationMap, lang)),
      url: `/${vars.slug}?open=announcement:${vars.id}`, // 23.3 AC2 deep link
    }),
  },
  request_status: {
    ttlSeconds: 900, // a stale "in progress" has no value (23.4 AC3)
    quietHours: false,
    topic: uuidTopic, // rapid transitions collapse per request
    compose: (lang, vars) => {
      const status = vars.status as RequestStatusPushKey;
      const name = localizeField(vars.names as TranslationMap, lang);
      const line = REQUEST_STATUS_LINES[lang][status](name);
      return {
        title: line.title,
        body: line.body,
        url: `/${vars.slug}?open=request:${vars.id}`,
      };
    },
  },
  order_status: {
    ttlSeconds: 900,
    quietHours: false,
    topic: uuidTopic, // collapse per order (23.4 AC3)
    compose: (lang, vars) => {
      const status = vars.status as OrderStatusPushKey;
      const itemCount = (vars.itemCount as number) ?? 0;
      const locationLine = (vars.locationLine ?? null) as string | null;
      const line = ORDER_STATUS_LINES[lang][status](itemCount, locationLine);
      return {
        title: line.title,
        body: line.body,
        url: `/${vars.slug}?open=order:${vars.id}`,
      };
    },
  },
  event_reminder: {
    ttlSeconds: 3600, // pointless after the event started
    quietHours: false, // 23.5 AC3 — the reminder IS the point
    topic: uuidTopic,
    compose: (lang, vars) => {
      const title = localizeField(vars.titles as TranslationMap, lang);
      const locationText = (vars.locationText ?? null) as string | null;
      const line = composeEventReminder(lang, title, vars.startTime as string, locationText);
      return {
        title: line.title,
        body: line.body,
        url: `/${vars.slug}?open=event:${vars.id}`,
      };
    },
  },
  checkout_reminder: {
    ttlSeconds: 4 * 3600,
    quietHours: false, // fires at 08:30 by design (23.5 AC3)
    topic: () => null, // one per stay, nothing to collapse
    compose: (lang, vars) => {
      const line = composeCheckoutReminder(
        lang,
        vars.checkoutTime as string,
        Boolean(vars.hasUnsettledBalance),
      );
      return {
        title: line.title,
        body: line.body,
        url: `/${vars.slug}?open=home`,
      };
    },
  },
  // Epic 26 — staff pushes. Per-lane collapse (latest wins on the device),
  // no quiet hours (shifts are the quiet hours), short TTLs.
  staff_assigned: {
    ttlSeconds: 3600,
    quietHours: false,
    topic: (_refId, vars) => `sa-${vars.feed}`,
    compose: (lang, vars) => {
      const v = vars as unknown as StaffPushVars;
      const line = STAFF_PUSH_LINES[staffLang(lang)].assigned[v.feed](v);
      return { ...line, url: staffUrl(vars.slug as string, v) };
    },
  },
  staff_available: {
    ttlSeconds: 900,
    quietHours: false,
    topic: (_refId, vars) => `sv-${vars.feed}`,
    compose: (lang, vars) => {
      const v = vars as unknown as StaffPushVars;
      const line = STAFF_PUSH_LINES[staffLang(lang)].available[v.feed](v);
      return { ...line, url: staffUrl(vars.slug as string, v) };
    },
  },
};
