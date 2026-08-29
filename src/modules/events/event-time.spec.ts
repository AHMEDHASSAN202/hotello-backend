import { addMinutesLocal, hotelLocalStamp } from './event-time';

describe('addMinutesLocal (Epic 21 hotel-local time arithmetic)', () => {
  it('adds minutes within the same hour/day', () => {
    expect(addMinutesLocal('2026-03-10 09:00', 30)).toBe('2026-03-10 09:30');
  });

  it('rolls over an hour boundary', () => {
    expect(addMinutesLocal('2026-03-10 09:45', 30)).toBe('2026-03-10 10:15');
  });

  it('rolls over a day boundary', () => {
    expect(addMinutesLocal('2026-03-10 23:30', 45)).toBe('2026-03-11 00:15');
  });

  it('rolls over a month boundary', () => {
    expect(addMinutesLocal('2026-03-31 23:50', 20)).toBe('2026-04-01 00:10');
  });

  it('handles negative minutes (subtracting time)', () => {
    expect(addMinutesLocal('2026-03-10 00:10', -20)).toBe('2026-03-09 23:50');
  });

  it('is a no-op for zero minutes', () => {
    expect(addMinutesLocal('2026-03-10 12:00', 0)).toBe('2026-03-10 12:00');
  });

  it('throws on a malformed stamp', () => {
    expect(() => addMinutesLocal('2026-03-10T12:00', 10)).toThrow();
    expect(() => addMinutesLocal('not-a-stamp', 10)).toThrow();
  });
});

describe('hotelLocalStamp', () => {
  it('formats hotel-local wall time as a comparable "YYYY-MM-DD HH:MM"', () => {
    // Cairo is UTC+2 in winter (repo TZ-test convention: use winter dates).
    expect(hotelLocalStamp('Africa/Cairo', new Date('2026-01-15T10:00:00Z'))).toBe(
      '2026-01-15 12:00',
    );
    expect(hotelLocalStamp('Europe/Moscow', new Date('2026-01-15T10:07:00Z'))).toBe(
      '2026-01-15 13:07',
    );
  });

  it('zero-pads across midnight (ICU hour-24 quirk covered upstream)', () => {
    expect(hotelLocalStamp('Africa/Cairo', new Date('2026-01-15T22:05:00Z'))).toBe(
      '2026-01-16 00:05',
    );
  });
});
