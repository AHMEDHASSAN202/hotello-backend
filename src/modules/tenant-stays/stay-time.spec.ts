import {
  daysBetween,
  hotelLocalParts,
  isStayOverdue,
  minutesOf,
} from './stay-time';

/**
 * Fixed instants; Africa/Cairo is UTC+3 in August (EEST), Asia/Dubai UTC+4,
 * America/New_York UTC-4 (EDT).
 */
describe('stay-time (13.4 AC3 — timezone edges)', () => {
  describe('hotelLocalParts', () => {
    it('rolls the local date past midnight ahead of UTC', () => {
      // 22:30 UTC = 01:30 next day in Cairo.
      const parts = hotelLocalParts(
        'Africa/Cairo',
        new Date('2026-08-20T22:30:00Z'),
      );
      expect(parts).toEqual({ date: '2026-08-21', minutes: 90 });
    });

    it('lags the local date behind UTC in western zones', () => {
      // 02:00 UTC on the 21st = 22:00 on the 20th in New York.
      const parts = hotelLocalParts(
        'America/New_York',
        new Date('2026-08-21T02:00:00Z'),
      );
      expect(parts).toEqual({ date: '2026-08-20', minutes: 22 * 60 });
    });
  });

  describe('minutesOf / daysBetween', () => {
    it('parses HH:MM', () => {
      expect(minutesOf('12:00')).toEqual(720);
      expect(minutesOf('00:30')).toEqual(30);
      expect(minutesOf('23:59')).toEqual(1439);
    });

    it('computes signed whole days', () => {
      expect(daysBetween('2026-08-20', '2026-08-23')).toEqual(3);
      expect(daysBetween('2026-08-23', '2026-08-20')).toEqual(-3);
      expect(daysBetween('2026-08-20', '2026-08-20')).toEqual(0);
    });
  });

  describe('isStayOverdue', () => {
    it('flips exactly at the hotel-local checkout minute', () => {
      // Cairo 11:59 local (08:59 UTC) — not yet.
      expect(
        isStayOverdue('2026-08-20', '12:00', 'Africa/Cairo', new Date('2026-08-20T08:59:00Z')),
      ).toBe(false);
      // Cairo 12:00 local — due.
      expect(
        isStayOverdue('2026-08-20', '12:00', 'Africa/Cairo', new Date('2026-08-20T09:00:00Z')),
      ).toBe(true);
    });

    it('01:00-local edge: due while UTC is still on the previous date', () => {
      // Dubai 00:45 local on the 20th = 20:45 UTC on the 19th.
      expect(
        isStayOverdue('2026-08-20', '00:30', 'Asia/Dubai', new Date('2026-08-19T20:45:00Z')),
      ).toBe(true);
    });

    it('23:00-local edge: not due although UTC already crossed the date', () => {
      // New York 22:00 local on the 20th = 02:00 UTC on the 21st.
      expect(
        isStayOverdue('2026-08-20', '23:00', 'America/New_York', new Date('2026-08-21T02:00:00Z')),
      ).toBe(false);
    });

    it('any later day is overdue regardless of the hour', () => {
      expect(
        isStayOverdue('2026-08-20', '12:00', 'Africa/Cairo', new Date('2026-08-21T01:00:00Z')),
      ).toBe(true);
    });

    it('days before the check-out date are never overdue', () => {
      expect(
        isStayOverdue('2026-08-22', '12:00', 'Africa/Cairo', new Date('2026-08-20T23:00:00Z')),
      ).toBe(false);
    });
  });
});
