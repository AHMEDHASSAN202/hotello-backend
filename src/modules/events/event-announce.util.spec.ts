import { composePublishAnnouncement, composeCancelAnnouncement } from './event-announce.util';
import { Event } from './event.entity';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    hotelId: 'hotel-1',
    titles: { en: 'Pool Party', ar: 'حفلة المسبح' },
    startAtLocal: '2026-09-05 20:00',
    endAtLocal: '2026-09-05 22:00',
    locationText: 'Main Pool',
    status: 'published',
    ...overrides,
  } as Event;
}

describe('event-announce.util — localized datetime (guest polish v1, item A1)', () => {
  it('composePublishAnnouncement never emits the raw YYYY-MM-DD HH:MM stamp', () => {
    const fields = composePublishAnnouncement(makeEvent());
    expect(fields.bodyEn).not.toContain('2026-09-05 20:00');
    expect(fields.bodyAr).not.toContain('2026-09-05 20:00');
  });

  it('composePublishAnnouncement formats English as weekday/day/month + 24h time, matching the event-card style', () => {
    const fields = composePublishAnnouncement(makeEvent());
    // Locks in the exact separator (' · ') this format mirrors from the
    // guest frontend's event card — a loose regex here previously would not
    // have caught the separator silently changing.
    expect(fields.bodyEn).toContain('Sat 5 Sept · 20:00');
  });

  it('composePublishAnnouncement formats Arabic with Latin digits (no Arabic-Indic numerals)', () => {
    const fields = composePublishAnnouncement(makeEvent());
    expect(fields.bodyAr).toMatch(/20:00/);
    expect(fields.bodyAr).not.toMatch(/[٠-٩]/);
  });

  it('composeCancelAnnouncement never emits the raw YYYY-MM-DD HH:MM stamp', () => {
    const fields = composeCancelAnnouncement(makeEvent(), 'Storm warning');
    expect(fields.bodyEn).not.toContain('2026-09-05 20:00');
    expect(fields.bodyAr).not.toContain('2026-09-05 20:00');
  });

  it('formats all 7 locales without throwing and each contains the formatted time', () => {
    const event = makeEvent({
      titles: {
        en: 'Pool Party',
        ar: 'حفلة المسبح',
        ru: 'Вечеринка у бассейна',
        fr: 'Fête à la piscine',
        it: 'Festa in piscina',
        es: 'Fiesta en la piscina',
        de: 'Poolparty',
      } as Event['titles'],
    });
    const fields = composePublishAnnouncement(event);
    for (const field of ['bodyEn', 'bodyAr', 'bodyRu', 'bodyFr', 'bodyIt', 'bodyEs', 'bodyDe']) {
      expect(fields[field]).toMatch(/20:00/);
    }
  });
});
