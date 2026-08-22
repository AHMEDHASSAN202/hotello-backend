import { isWithinWindow, menuAvailability } from './fnb-availability';

const m = (hhmm: string): number => {
  const [h, mm] = hhmm.split(':').map(Number);
  return h * 60 + mm;
};

describe('fnb availability windows (16.2 AC1, spec note 2)', () => {
  describe('isWithinWindow', () => {
    it('normal window: start-inclusive, end-exclusive', () => {
      const w = { start: '07:00', end: '11:00' };
      expect(isWithinWindow(w, m('07:00'))).toBe(true);
      expect(isWithinWindow(w, m('10:59'))).toBe(true);
      expect(isWithinWindow(w, m('11:00'))).toBe(false);
      expect(isWithinWindow(w, m('06:59'))).toBe(false);
    });

    it('overnight window 20:00–02:00 wraps midnight', () => {
      const w = { start: '20:00', end: '02:00' };
      expect(isWithinWindow(w, m('20:00'))).toBe(true);
      expect(isWithinWindow(w, m('23:59'))).toBe(true);
      expect(isWithinWindow(w, m('00:00'))).toBe(true);
      expect(isWithinWindow(w, m('01:59'))).toBe(true);
      expect(isWithinWindow(w, m('02:00'))).toBe(false);
      expect(isWithinWindow(w, m('19:59'))).toBe(false);
    });

    it('degenerate equal start/end reads as always open', () => {
      expect(isWithinWindow({ start: '00:00', end: '00:00' }, m('13:37'))).toBe(
        true,
      );
    });
  });

  describe('menuAvailability', () => {
    it('no windows = always available', () => {
      expect(menuAvailability([], m('03:00'))).toEqual({
        available: true,
        opensAt: null,
      });
    });

    it('inside any of multiple windows = available', () => {
      const windows = [
        { start: '07:00', end: '11:00' },
        { start: '19:00', end: '23:00' },
      ];
      expect(menuAvailability(windows, m('20:00')).available).toBe(true);
      expect(menuAvailability(windows, m('12:00')).available).toBe(false);
    });

    it('closed: opensAt is the next start today', () => {
      const windows = [
        { start: '07:00', end: '11:00' },
        { start: '19:00', end: '23:00' },
      ];
      expect(menuAvailability(windows, m('12:00'))).toEqual({
        available: false,
        opensAt: '19:00',
      });
    });

    it('closed after the last window: opensAt wraps to tomorrow morning', () => {
      const windows = [{ start: '07:00', end: '11:00' }];
      expect(menuAvailability(windows, m('23:30'))).toEqual({
        available: false,
        opensAt: '07:00',
      });
    });
  });
});
