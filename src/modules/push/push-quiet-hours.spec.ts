import { quietHold } from './push-quiet-hours';

describe('quietHold (23.3 AC4)', () => {
  // Winter dates — Africa/Cairo observes DST (memory: guest-fe-test-clock-gotchas).
  const tz = 'Africa/Cairo'; // UTC+2 in winter

  it('returns null outside the window', () => {
    expect(quietHold(tz, new Date('2026-01-15T10:00:00Z'), '22:00', '08:00')).toBeNull(); // 12:00 local
  });

  it('holds until window end when inside (crossing midnight)', () => {
    const held = quietHold(tz, new Date('2026-01-15T21:00:00Z'), '22:00', '08:00'); // 23:00 local
    expect(held).toEqual(new Date('2026-01-16T06:00:00Z')); // 08:00 local next day
  });

  it('holds in the early-morning half of the window', () => {
    const held = quietHold(tz, new Date('2026-01-15T03:00:00Z'), '22:00', '08:00'); // 05:00 local
    expect(held).toEqual(new Date('2026-01-15T06:00:00Z'));
  });

  it('start === end disables the window', () => {
    expect(quietHold(tz, new Date('2026-01-15T21:00:00Z'), '08:00', '08:00')).toBeNull();
  });
});
