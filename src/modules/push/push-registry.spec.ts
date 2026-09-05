import { GUEST_LANGUAGES } from '../tenant-stays/stays.constants';
import { PUSH_TYPES } from './push.constants';
import { PUSH_REGISTRY } from './push-registry';

describe('PUSH_REGISTRY completeness (23.1 AC4, note 4)', () => {
  it.each(PUSH_TYPES)('type %s has a full spec', (type) => {
    const spec = PUSH_REGISTRY[type];
    expect(spec.ttlSeconds).toBeGreaterThan(0);
    expect(typeof spec.quietHours).toBe('boolean');
  });

  it.each(PUSH_TYPES)('type %s composes non-empty title/body/url in all 7 locales', (type) => {
    const vars = sampleVars(type); // helper below
    for (const lang of GUEST_LANGUAGES) {
      const out = PUSH_REGISTRY[type].compose(lang, vars);
      expect(out.title.length).toBeGreaterThan(0);
      expect(out.body.length).toBeGreaterThan(0);
      // Staff types (Epic 26) deep-link into the tenant dashboard route
      // (`/t/{slug}?open=...`), not the guest app's bare `/{slug}` route.
      expect(
        out.url.startsWith('/sunrise') || out.url.startsWith('/t/sunrise'),
      ).toBe(true);
    }
  });

  it('status topics fit the Web Push limit (base64url, ≤32 chars)', () => {
    const topic = PUSH_REGISTRY.order_status.topic('123e4567-e89b-12d3-a456-426614174000', {});
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it('order_status includes the located destination when present (23.4 AC2)', () => {
    const out = PUSH_REGISTRY.order_status.compose('ar', {
      ...sampleVars('order_status'),
      status: 'on_the_way',
      locationLine: 'البسين، شمسية 12',
    });
    expect(out.body).toContain('شمسية 12');
  });

  it('checkout_reminder appends the balance line only when unsettled (23.5 AC2)', () => {
    const base = sampleVars('checkout_reminder');
    const without = PUSH_REGISTRY.checkout_reminder.compose('ar', { ...base, hasUnsettledBalance: false });
    const withBal = PUSH_REGISTRY.checkout_reminder.compose('ar', { ...base, hasUnsettledBalance: true });
    expect(without.body).not.toContain('مشتريات');
    expect(withBal.body).toContain('مشتريات');
  });

  describe('staff types (26.4 AC2/AC3/AC5)', () => {
    it('staff_assigned/rooms deep-links to the rooms tab with the room highlighted', () => {
      const out = PUSH_REGISTRY.staff_assigned.compose('ar', { slug: 'sunrise', feed: 'rooms', id: 'room-1', roomNumber: '304', cleaningType: 'checkout' });
      expect(out.url).toBe('/t/sunrise?open=rooms:room-1');
      expect(out.title).toContain('304');
    });
    it('staff_available bulk rooms line carries the count and links to the tab', () => {
      const out = PUSH_REGISTRY.staff_available.compose('en', { slug: 'sunrise', feed: 'rooms', count: 12 });
      expect(out.url).toBe('/t/sunrise?open=rooms');
      expect(out.body).toContain('12');
    });
    it('topics collapse per lane, not per task', () => {
      expect(PUSH_REGISTRY.staff_assigned.topic('any-id', { feed: 'orders' })).toBe('sa-orders');
      expect(PUSH_REGISTRY.staff_available.topic(null, { feed: 'requests' })).toBe('sv-requests');
    });
    it('staff types never apply quiet hours', () => {
      expect(PUSH_REGISTRY.staff_assigned.quietHours).toBe(false);
      expect(PUSH_REGISTRY.staff_available.quietHours).toBe(false);
    });
    it('non-AR locales fall back to English copy (staff is AR/EN only)', () => {
      const out = PUSH_REGISTRY.staff_available.compose('ru', { slug: 's', feed: 'orders', id: 'o1', roomNumber: '12', locationNames: null });
      expect(out.title).toMatch(/order/i);
    });
  });
});

function sampleVars(type: string): Record<string, unknown> {
  const base = { slug: 'sunrise' };
  switch (type) {
    case 'announcement':
      return { ...base, id: 'a1', titles: { en: 'Pool closed', ar: 'المسبح مغلق' }, bodies: { en: 'Body', ar: 'نص' } };
    case 'request_status':
      return { ...base, id: 'r1', names: { en: 'Extra towels', ar: 'مناشف إضافية' }, status: 'in_progress' };
    case 'order_status':
      return { ...base, id: 'o1', status: 'preparing', itemCount: 3, locationLine: null };
    case 'event_reminder':
      return { ...base, id: 'e1', titles: { en: 'Yoga', ar: 'ورشة اليوجا' }, startTime: '17:00', locationText: 'Beach, Bldg B' };
    case 'checkout_reminder':
      return { ...base, checkoutTime: '12:00', hasUnsettledBalance: false };
    case 'staff_assigned':
    case 'staff_available':
      return {
        ...base,
        feed: 'requests',
        id: 'r1',
        roomNumber: '304',
        names: { ar: 'مناشف إضافية', en: 'Extra towels' },
      };
    default:
      return base;
  }
}
