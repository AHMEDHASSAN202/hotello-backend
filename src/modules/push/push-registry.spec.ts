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
      expect(out.url.startsWith('/sunrise')).toBe(true);
    }
  });

  it('status topics fit the Web Push limit (base64url, ≤32 chars)', () => {
    const topic = PUSH_REGISTRY.order_status.topic('123e4567-e89b-12d3-a456-426614174000');
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
    default:
      return base;
  }
}
