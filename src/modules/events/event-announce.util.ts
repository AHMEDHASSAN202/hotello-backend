import { GUEST_LANGUAGES, GuestLanguage } from '../tenant-stays/stays.constants';
import { Event } from './event.entity';

/**
 * Story 21.3 AC1/AC3 — the flat `titleXx`/`bodyXx` fields
 * `TenantAnnouncementsService.create()` expects, auto-composed from an
 * event's own 7-locale `titles` map. Only locales the event actually has a
 * title for are emitted (ar/en always, since `Event.titles` requires both);
 * `mergeTitles`/`mergeBodies` on the announcement side only look at the
 * keys present, so a partial map here is safe.
 */
type FlatAnnouncementFields = Record<string, string>;

const TITLE_FIELD: Record<GuestLanguage, string> = {
  ar: 'titleAr',
  en: 'titleEn',
  ru: 'titleRu',
  fr: 'titleFr',
  it: 'titleIt',
  es: 'titleEs',
  de: 'titleDe',
};

const BODY_FIELD: Record<GuestLanguage, string> = {
  ar: 'bodyAr',
  en: 'bodyEn',
  ru: 'bodyRu',
  fr: 'bodyFr',
  it: 'bodyIt',
  es: 'bodyEs',
  de: 'bodyDe',
};

/** "New event: {title} — {when} at {where}." per language, kept simple (21.3 AC1). */
const PUBLISH_BODY: Record<
  GuestLanguage,
  (title: string, when: string, where: string) => string
> = {
  en: (t, w, l) => `New event: ${t} — ${w} at ${l}.`,
  ar: (t, w, l) => `فعالية جديدة: ${t} — ${w} في ${l}.`,
  ru: (t, w, l) => `Новое мероприятие: ${t} — ${w}, ${l}.`,
  fr: (t, w, l) => `Nouvel événement : ${t} — ${w} à ${l}.`,
  it: (t, w, l) => `Nuovo evento: ${t} — ${w} presso ${l}.`,
  es: (t, w, l) => `Nuevo evento: ${t} — ${w} en ${l}.`,
  de: (t, w, l) => `Neue Veranstaltung: ${t} — ${w} in ${l}.`,
};

/** "\"{title}\" ({when}) has been cancelled. {reason}" per language (21.2 AC3). */
const CANCEL_BODY: Record<
  GuestLanguage,
  (title: string, when: string, reason: string) => string
> = {
  en: (t, w, r) => `"${t}" (${w}) has been cancelled. ${r}`,
  ar: (t, w, r) => `تم إلغاء "${t}" (${w}). ${r}`,
  ru: (t, w, r) => `«${t}» (${w}) отменено. ${r}`,
  fr: (t, w, r) => `« ${t} » (${w}) a été annulé. ${r}`,
  it: (t, w, r) => `"${t}" (${w}) è stato annullato. ${r}`,
  es: (t, w, r) => `"${t}" (${w}) ha sido cancelado. ${r}`,
  de: (t, w, r) => `"${t}" (${w}) wurde abgesagt. ${r}`,
};

function composeFields(
  event: Event,
  compose: (lang: GuestLanguage, title: string) => string,
): FlatAnnouncementFields {
  const fields: FlatAnnouncementFields = {};
  for (const lang of GUEST_LANGUAGES) {
    const title = event.titles[lang];
    if (!title) continue;
    fields[TITLE_FIELD[lang]] = title;
    fields[BODY_FIELD[lang]] = compose(lang, title);
  }
  return fields;
}

export function composePublishAnnouncement(event: Event): FlatAnnouncementFields {
  return composeFields(event, (lang, title) =>
    PUBLISH_BODY[lang](title, event.startAtLocal, event.locationText),
  );
}

export function composeCancelAnnouncement(
  event: Event,
  reason: string,
): FlatAnnouncementFields {
  return composeFields(event, (lang, title) =>
    CANCEL_BODY[lang](title, event.startAtLocal, reason),
  );
}
