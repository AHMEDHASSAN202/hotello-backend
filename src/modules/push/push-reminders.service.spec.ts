import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not } from 'typeorm';
import { EventBooking } from '../events/event-booking.entity';
import { Event } from '../events/event.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { PushService } from './push.service';
import { PushRemindersService } from './push-reminders.service';

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: 'hotel-1',
    status: 'active',
    timezone: 'Africa/Cairo', // UTC+2 in winter — the DST gotcha, use winter instants only
    checkoutTime: '12:00',
    slug: 'sunrise',
    ...o,
  }) as Hotel;

const makeEvent = (o: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    hotelId: 'hotel-1',
    status: 'published',
    startAtLocal: '2026-01-15 12:30',
    titles: { en: 'Sunset Yoga', ar: 'يوجا الغروب' },
    locationText: 'Beach, Building B',
    ...o,
  }) as Event;

const makeBooking = (o: Partial<EventBooking> = {}): EventBooking =>
  ({
    id: 'booking-1',
    hotelId: 'hotel-1',
    eventId: 'event-1',
    stayId: 'stay-1',
    status: 'booked',
    ...o,
  }) as EventBooking;

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    status: 'active',
    checkOutDate: '2026-01-15',
    ...o,
  }) as Stay;

describe('PushRemindersService (23.5)', () => {
  let service: PushRemindersService;
  let hotelsRepo: Record<string, jest.Mock>;
  let eventsRepo: Record<string, jest.Mock>;
  let bookingsRepo: Record<string, jest.Mock>;
  let staysRepo: Record<string, jest.Mock>;
  let ordersRepo: Record<string, jest.Mock>;
  let push: { notify: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { find: jest.fn().mockResolvedValue([makeHotel()]) };
    eventsRepo = { find: jest.fn().mockResolvedValue([]) };
    bookingsRepo = { find: jest.fn().mockResolvedValue([]) };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    ordersRepo = { count: jest.fn().mockResolvedValue(0) };
    push = { notify: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn((_key: string, def: unknown) => def) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushRemindersService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
        { provide: PushService, useValue: push },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(PushRemindersService);
  });

  describe('event reminders (AC1)', () => {
    it('reminds booked guests when event start is within the next 60 hotel-local minutes', async () => {
      // Cairo winter UTC+2: 10:00Z = 12:00 local. Event starts 12:30 local — 30min out, within the window.
      eventsRepo.find.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([makeBooking()]);

      const result = await service.run(new Date('2026-01-15T10:00:00Z'));

      expect(result.eventReminders).toBe(1);
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'event_reminder',
        {
          refId: 'booking-1',
          dedupePrefix: 'event_reminder:booking-1',
          vars: {
            id: 'event-1',
            titles: { en: 'Sunset Yoga', ar: 'يوجا الغروب' },
            startTime: '12:30',
            locationText: 'Beach, Building B',
          },
        },
      );
    });

    it('is idempotent per booking: dedupePrefix event_reminder:{bookingId}', async () => {
      eventsRepo.find.mockResolvedValue([makeEvent()]);
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'booking-a', stayId: 'stay-a' }),
        makeBooking({ id: 'booking-b', stayId: 'stay-b' }),
      ]);

      await service.run(new Date('2026-01-15T10:00:00Z'));

      expect(push.notify).toHaveBeenCalledTimes(2);
      expect(push.notify).toHaveBeenNthCalledWith(
        1,
        'hotel-1',
        { stayIds: ['stay-a'] },
        'event_reminder',
        expect.objectContaining({ dedupePrefix: 'event_reminder:booking-a' }),
      );
      expect(push.notify).toHaveBeenNthCalledWith(
        2,
        'hotel-1',
        { stayIds: ['stay-b'] },
        'event_reminder',
        expect.objectContaining({ dedupePrefix: 'event_reminder:booking-b' }),
      );
    });

    it('skips cancelled bookings and cancelled/draft events (23.5 AC1)', async () => {
      // Excluded by construction: the events query filters status: 'published',
      // the bookings query filters status: 'booked' — cancelled/draft rows are
      // never returned by `find` in the first place (the EventSchedulerService
      // precedent).
      const events = [
        makeEvent({ id: 'draft-1', status: 'draft' }),
        makeEvent({ id: 'cancelled-1', status: 'cancelled' }),
        makeEvent({ id: 'published-1', status: 'published' }),
      ];
      eventsRepo.find.mockImplementation(
        async ({ where }: { where: { hotelId: string; status: string } }) =>
          events.filter((e) => e.hotelId === where.hotelId && e.status === where.status),
      );
      const bookings = [
        makeBooking({ id: 'cancelled-booking', eventId: 'published-1', status: 'cancelled' }),
        makeBooking({ id: 'booked-1', eventId: 'published-1', status: 'booked' }),
      ];
      bookingsRepo.find.mockImplementation(
        async ({ where }: { where: { eventId: string; status: string } }) =>
          bookings.filter((b) => b.eventId === where.eventId && b.status === where.status),
      );

      const result = await service.run(new Date('2026-01-15T10:00:00Z'));

      expect(result.eventReminders).toBe(1);
      expect(push.notify).toHaveBeenCalledTimes(1);
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'event_reminder',
        expect.objectContaining({ refId: 'booked-1' }),
      );
    });

    it('does not remind for events starting later than 60 minutes out', async () => {
      // 10:00Z = 12:00 local; horizon = 13:00 local. 13:01 is 1 minute past it.
      eventsRepo.find.mockResolvedValue([makeEvent({ startAtLocal: '2026-01-15 13:01' })]);
      bookingsRepo.find.mockResolvedValue([makeBooking()]);

      const result = await service.run(new Date('2026-01-15T10:00:00Z'));

      expect(result.eventReminders).toBe(0);
      expect(push.notify).not.toHaveBeenCalled();
      expect(bookingsRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('checkout reminders (AC2)', () => {
    it('checkout reminder fires on departure day at/after PUSH_CHECKOUT_REMINDER_TIME hotel-local', async () => {
      staysRepo.find.mockResolvedValue([makeStay()]);

      // 06:00Z = 08:00 local — before the default 08:30 threshold.
      let result = await service.run(new Date('2026-01-15T06:00:00Z'));
      expect(result.checkoutReminders).toBe(0);
      expect(push.notify).not.toHaveBeenCalled();

      // 06:30Z = 08:30 local — at the threshold, fires.
      result = await service.run(new Date('2026-01-15T06:30:00Z'));
      expect(result.checkoutReminders).toBe(1);
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'checkout_reminder',
        expect.objectContaining({
          refId: 'stay-1',
          vars: { checkoutTime: '12:00', hasUnsettledBalance: false },
        }),
      );
    });

    it('checkout reminder is once per stay: dedupePrefix checkout_reminder:{stayId}', async () => {
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'stay-a' }),
        makeStay({ id: 'stay-b' }),
      ]);

      await service.run(new Date('2026-01-15T06:30:00Z'));

      expect(push.notify).toHaveBeenCalledTimes(2);
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-a'] },
        'checkout_reminder',
        expect.objectContaining({ dedupePrefix: 'checkout_reminder:stay-a' }),
      );
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-b'] },
        'checkout_reminder',
        expect.objectContaining({ dedupePrefix: 'checkout_reminder:stay-b' }),
      );
    });

    it('includes hasUnsettledBalance=true when a delivered room_charge order is unsettled (16.8 fields)', async () => {
      staysRepo.find.mockResolvedValue([makeStay()]);
      ordersRepo.count.mockResolvedValue(1);

      await service.run(new Date('2026-01-15T06:30:00Z'));

      expect(ordersRepo.count).toHaveBeenCalledWith({
        where: {
          stayId: 'stay-1',
          paymentMethod: 'room_charge',
          status: 'delivered',
          settledAt: expect.anything(),
        },
      });
      expect(push.notify).toHaveBeenCalledWith(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'checkout_reminder',
        expect.objectContaining({
          vars: { checkoutTime: '12:00', hasUnsettledBalance: true },
        }),
      );
    });
  });

  it('skips suspended hotels', async () => {
    const hotels = [makeHotel({ id: 'hotel-active' }), makeHotel({ id: 'hotel-suspended', status: 'suspended' })];
    // Simulate TypeORM's Not('suspended') filtering at the DB layer.
    hotelsRepo.find.mockImplementation(async () => hotels.filter((h) => h.status !== 'suspended'));
    // The suspended hotel has a due event/booking and a departing stay — if the
    // suspended-hotel filter were missing, these would produce reminders.
    eventsRepo.find.mockImplementation(async ({ where }: { where: { hotelId: string } }) =>
      where.hotelId === 'hotel-suspended' ? [makeEvent({ hotelId: 'hotel-suspended' })] : [],
    );
    bookingsRepo.find.mockResolvedValue([makeBooking()]);
    staysRepo.find.mockImplementation(async ({ where }: { where: { hotelId: string } }) =>
      where.hotelId === 'hotel-suspended' ? [makeStay({ hotelId: 'hotel-suspended' })] : [],
    );

    const result = await service.run(new Date('2026-01-15T06:30:00Z'));

    expect(hotelsRepo.find).toHaveBeenCalledWith({ where: { status: Not('suspended') } });
    expect(result).toEqual({ eventReminders: 0, checkoutReminders: 0 });
    expect(push.notify).not.toHaveBeenCalled();
  });
});
