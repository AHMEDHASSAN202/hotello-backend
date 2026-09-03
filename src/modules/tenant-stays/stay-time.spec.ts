import {
  daysBetween,
  fromNaive,
  hotelLocalParts,
  isStayOverdue,
  minutesOf,
  startOfHotelDay,
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

  describe('startOfHotelDay (Epic 15 — daily throttle bucket)', () => {
    it('returns the UTC instant of Cairo local midnight', () => {
      // 01:30 Cairo on Aug 21 → local midnight was 21:00 UTC on Aug 20.
      const start = startOfHotelDay(
        'Africa/Cairo',
        new Date('2026-08-20T22:30:45.500Z'),
      );
      expect(start.toISOString()).toBe('2026-08-20T21:00:00.000Z');
    });

    it('handles western zones lagging UTC', () => {
      // 22:00 New York on Aug 20 → local midnight was 04:00 UTC on Aug 20.
      const start = startOfHotelDay(
        'America/New_York',
        new Date('2026-08-21T02:00:00.000Z'),
      );
      expect(start.toISOString()).toBe('2026-08-20T04:00:00.000Z');
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

  describe('fromNaive (Epic 22 final review, C1 — read-side naive timestamp fix)', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it.each([
      ['UTC', 0],
      ['Africa/Cairo', 180],
      ['America/New_York', -240],
      ['Asia/Dubai', 240],
      ['Pacific/Kiritimati', 840],
    ])(
      'recovers the original UTC-wall instant when the host runs as %s',
      (tz) => {
        process.env.TZ = tz;
        // Wall-clock components as they were written to the naive column
        // (naiveUtc's convention: storage is UTC wall time).
        const wall = {
          y: 2026,
          mo: 7, // August (0-indexed)
          d: 25,
          h: 12,
          mi: 28,
          s: 36,
          ms: 5,
        };
        // Simulates pg's mis-parse: it hands back a Date built from the
        // wall-clock components read as HOST-LOCAL (exactly what the local
        // `new Date(y, m, d, ...)` constructor does under `process.env.TZ`).
        const pgReturned = new Date(
          wall.y,
          wall.mo,
          wall.d,
          wall.h,
          wall.mi,
          wall.s,
          wall.ms,
        );

        const recovered = fromNaive(pgReturned);

        const expected = new Date(
          Date.UTC(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s, wall.ms),
        );
        expect(recovered.getTime()).toBe(expected.getTime());
        expect(recovered.toISOString()).toBe('2026-08-25T12:28:36.005Z');
      },
    );

    it('round-trips a value with zero milliseconds and a midnight boundary', () => {
      process.env.TZ = 'America/New_York';
      const pgReturned = new Date(2026, 0, 1, 0, 0, 0, 0);
      const recovered = fromNaive(pgReturned);
      expect(recovered.toISOString()).toBe('2026-01-01T00:00:00.000Z');
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
