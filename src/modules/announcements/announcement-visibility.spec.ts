import { Stay } from '../tenant-stays/stay.entity';
import { Announcement } from './announcement.entity';
import {
  hotelLocalStamp,
  isVisibleToStay,
  isWithinWindow,
  matchesAudience,
} from './announcement-visibility';
import { AudienceFilter } from './announcements.constants';

/**
 * Spec note 2 — the visibility matrix. ONE function answers
 * `(announcement, stay) → visible?` for the guest feed, the recipient-count
 * preview and the read-stats denominator; these tests are that contract.
 */

const makeStay = (overrides: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    roomId: 'room-1',
    room: { id: 'room-1', roomNumber: '204', floor: 2 },
    stayType: 'all_inclusive',
    status: 'active',
    language: 'en',
    ...overrides,
  }) as unknown as Stay;

const makeAnnouncement = (
  overrides: Partial<Announcement> = {},
): Announcement =>
  ({
    id: 'ann-1',
    hotelId: 'hotel-1',
    status: 'live',
    audience: {},
    activeUntilLocal: null,
    priority: false,
    ...overrides,
  }) as unknown as Announcement;

const NOW_LOCAL = '2026-01-15 12:00';

describe('matchesAudience (19.1 AC2/AC3)', () => {
  it('empty or absent filter matches every stay', () => {
    expect(matchesAudience({}, makeStay())).toBe(true);
    expect(matchesAudience(null, makeStay())).toBe(true);
    expect(matchesAudience(undefined, makeStay())).toBe(true);
  });

  it('matches by stay type (multi)', () => {
    const filter: AudienceFilter = { stayTypes: ['all_inclusive', 'half_board'] };
    expect(matchesAudience(filter, makeStay())).toBe(true);
    expect(
      matchesAudience(filter, makeStay({ stayType: 'room_only' })),
    ).toBe(false);
  });

  it('matches by floor via the room relation', () => {
    const filter: AudienceFilter = { floors: [2, 3] };
    expect(matchesAudience(filter, makeStay())).toBe(true);
    expect(
      matchesAudience(
        filter,
        makeStay({ room: { id: 'room-9', roomNumber: '901', floor: 9 } } as never),
      ),
    ).toBe(false);
  });

  it('rejects floor filters when the room has no floor', () => {
    expect(
      matchesAudience(
        { floors: [2] },
        makeStay({ room: { id: 'room-x', roomNumber: 'X', floor: null } } as never),
      ),
    ).toBe(false);
  });

  it('matches by specific room ids', () => {
    expect(matchesAudience({ roomIds: ['room-1', 'room-2'] }, makeStay())).toBe(
      true,
    );
    expect(matchesAudience({ roomIds: ['room-2'] }, makeStay())).toBe(false);
  });

  it('ANDs combined dimensions (stay type + floor)', () => {
    const filter: AudienceFilter = { stayTypes: ['all_inclusive'], floors: [3] };
    // Stay type matches but floor does not → not in the audience.
    expect(matchesAudience(filter, makeStay())).toBe(false);
    expect(
      matchesAudience(
        filter,
        makeStay({ room: { id: 'room-3', roomNumber: '301', floor: 3 } } as never),
      ),
    ).toBe(true);
  });

  it('stayId targets exactly one stay and ignores other dimensions', () => {
    const filter: AudienceFilter = { stayId: 'stay-1', stayTypes: ['room_only'] };
    expect(matchesAudience(filter, makeStay())).toBe(true);
    expect(matchesAudience({ stayId: 'stay-2' }, makeStay())).toBe(false);
  });

  it("dynamic audience: tonight's check-in matching the filter is included (AC3)", () => {
    // The filter is stored, never a snapshot — a brand-new stay object that
    // matches is visible with no reference to when the announcement went out.
    const tonight = makeStay({ id: 'stay-new', roomId: 'room-7' });
    expect(matchesAudience({ stayTypes: ['all_inclusive'] }, tonight)).toBe(true);
  });
});

describe('isWithinWindow (19.2 AC1 active-until)', () => {
  it('no activeUntil → always within the window', () => {
    expect(isWithinWindow(makeAnnouncement(), NOW_LOCAL)).toBe(true);
  });

  it('expires inclusively at the activeUntil minute', () => {
    const a = makeAnnouncement({ activeUntilLocal: '2026-01-15 12:00' });
    expect(isWithinWindow(a, '2026-01-15 11:59')).toBe(true);
    expect(isWithinWindow(a, '2026-01-15 12:00')).toBe(false);
    expect(isWithinWindow(a, '2026-01-15 12:01')).toBe(false);
  });
});

describe('isVisibleToStay (spec note 2 — the single visibility function)', () => {
  it('live + in window + matching filter → visible', () => {
    expect(isVisibleToStay(makeAnnouncement(), makeStay(), NOW_LOCAL)).toBe(true);
  });

  it.each(['draft', 'scheduled', 'retracted', 'expired'] as const)(
    'status %s is never visible even in window',
    (status) => {
      expect(
        isVisibleToStay(makeAnnouncement({ status }), makeStay(), NOW_LOCAL),
      ).toBe(false);
    },
  );

  it('live but past active-until → not visible (before the cron flips it)', () => {
    const a = makeAnnouncement({ activeUntilLocal: '2026-01-15 08:00' });
    expect(isVisibleToStay(a, makeStay(), NOW_LOCAL)).toBe(false);
  });

  it('live but audience mismatch → not visible', () => {
    const a = makeAnnouncement({ audience: { floors: [9] } });
    expect(isVisibleToStay(a, makeStay(), NOW_LOCAL)).toBe(false);
  });
});

describe('hotelLocalStamp', () => {
  it('formats hotel-local wall time as a comparable "YYYY-MM-DD HH:MM"', () => {
    // Cairo is UTC+2 in winter (repo TZ-test convention: use winter dates).
    expect(
      hotelLocalStamp('Africa/Cairo', new Date('2026-01-15T10:00:00Z')),
    ).toBe('2026-01-15 12:00');
    expect(
      hotelLocalStamp('Europe/Moscow', new Date('2026-01-15T10:07:00Z')),
    ).toBe('2026-01-15 13:07');
  });

  it('zero-pads across midnight (ICU hour-24 quirk covered upstream)', () => {
    expect(
      hotelLocalStamp('Africa/Cairo', new Date('2026-01-15T22:05:00Z')),
    ).toBe('2026-01-16 00:05');
  });
});
