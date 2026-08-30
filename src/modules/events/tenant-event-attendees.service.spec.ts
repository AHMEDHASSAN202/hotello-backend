import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { TenantEventAttendeesService } from './tenant-event-attendees.service';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantEventsService } from './tenant-events.service';

const HOTEL_ID = 'hotel-1';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeEvent = (o: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    hotelId: HOTEL_ID,
    titles: { ar: 'حفلة', en: 'Party' },
    descriptions: { ar: 'وصف', en: 'Description' },
    photoKeys: null,
    startAtLocal: '2026-06-01 18:00',
    endAtLocal: '2026-06-01 20:00',
    locationText: 'Pool deck',
    infoEntryId: null,
    capacity: 20,
    price: 50,
    includedFor: [],
    status: 'published',
    cancelReason: null,
    createdById: 'user-1',
    publishedAt: new Date(),
    cancelledAt: null,
    completedAt: null,
    cancelledById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as Event;

const makeBooking = (o: Partial<EventBooking> = {}): EventBooking =>
  ({
    id: 'booking-1',
    hotelId: HOTEL_ID,
    eventId: 'event-1',
    stayId: 'stay-1',
    partySize: 2,
    snapshot: { titles: { ar: 'حفلة', en: 'Party' }, startAtLocal: '2026-06-01 18:00', endAtLocal: null, locationText: 'Pool deck' },
    unitPrice: 50,
    included: false,
    totalAmount: 100,
    currency: 'EGP',
    paymentMethod: 'cash',
    status: 'booked',
    cancelledBy: null,
    cancelledAt: null,
    cancelledReason: null,
    settledAt: null,
    settledById: null,
    createdAt: new Date('2026-05-20T10:00:00Z'),
    updatedAt: new Date('2026-05-20T10:00:00Z'),
    ...o,
  }) as EventBooking;

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    roomId: 'room-1',
    guestName: 'Ahmed Ali',
    email: null,
    phone: null,
    language: 'en',
    guestsCount: 2,
    stayType: 'room_only',
    note: null,
    codeHash: 'hash',
    checkInDate: '2026-05-18',
    checkOutDate: '2026-05-25',
    status: 'active',
    checkoutType: null,
    checkedOutAt: null,
    checkedOutById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    room: { roomNumber: '101' } as Stay['room'],
    ...o,
  }) as Stay;

describe('TenantEventAttendeesService (Story 21.6 AC1)', () => {
  let service: TenantEventAttendeesService;
  let bookingsRepo: { find: jest.Mock };
  let staysRepo: { find: jest.Mock };
  let events: { findEvent: jest.Mock; toManageView: jest.Mock };

  beforeEach(async () => {
    bookingsRepo = { find: jest.fn().mockResolvedValue([]) };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    events = {
      findEvent: jest.fn(),
      toManageView: jest.fn((e: Event) => ({ id: e.id, capacity: e.capacity })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantEventAttendeesService,
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: TenantEventsService, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(TenantEventAttendeesService);
  });

  it('404s for a missing or cross-tenant event (delegates to findEvent)', async () => {
    events.findEvent.mockRejectedValue(
      new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found' }),
    );
    await expect(service.list(actor, 'event-1')).rejects.toMatchObject({
      response: { code: 'EVENT_NOT_FOUND' },
    });
    expect(events.findEvent).toHaveBeenCalledWith(HOTEL_ID, 'event-1');
    // Never queries bookings once the event lookup fails.
    expect(bookingsRepo.find).not.toHaveBeenCalled();
  });

  it('resolves guest name / room number by batch-loading Stay with its room relation', async () => {
    events.findEvent.mockResolvedValue(makeEvent());
    bookingsRepo.find.mockResolvedValue([
      makeBooking({ id: 'b1', stayId: 'stay-1' }),
    ]);
    staysRepo.find.mockResolvedValue([
      makeStay({ id: 'stay-1', guestName: 'Ahmed Ali', room: { roomNumber: '101' } as Stay['room'] }),
    ]);

    const result = await service.list(actor, 'event-1');

    expect(staysRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ relations: ['room'] }),
    );
    expect(result.bookings[0]).toMatchObject({
      guestName: 'Ahmed Ali',
      roomNumber: '101',
      partySize: 2,
      paymentMethod: 'cash',
      status: 'booked',
    });
  });

  it('falls back to blank guest/room fields if the stay was not found in the batch', async () => {
    events.findEvent.mockResolvedValue(makeEvent());
    bookingsRepo.find.mockResolvedValue([makeBooking({ stayId: 'stay-missing' })]);
    staysRepo.find.mockResolvedValue([]);

    const result = await service.list(actor, 'event-1');

    expect(result.bookings[0].guestName).toBe('');
    expect(result.bookings[0].roomNumber).toBe('');
  });

  describe('totals', () => {
    it('sums partySize across booked bookings only — cancelled bookings excluded', async () => {
      events.findEvent.mockResolvedValue(makeEvent({ capacity: 20 }));
      bookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'b1', stayId: 's1', partySize: 2, status: 'booked' }),
        makeBooking({ id: 'b2', stayId: 's2', partySize: 4, status: 'booked' }),
        makeBooking({ id: 'b3', stayId: 's3', partySize: 6, status: 'cancelled' }),
      ]);
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 's1' }),
        makeStay({ id: 's2' }),
        makeStay({ id: 's3' }),
      ]);

      const result = await service.list(actor, 'event-1');

      expect(result.totals.booked).toBe(6);
      expect(result.totals.capacity).toBe(20);
      // The cancelled booking still surfaces in the list...
      expect(result.bookings).toHaveLength(3);
      expect(result.bookings.find((b) => b.status === 'cancelled')).toBeDefined();
    });

    it('splits expected cash vs room-charge sums, excluding already-settled room-charge bookings', async () => {
      events.findEvent.mockResolvedValue(makeEvent());
      bookingsRepo.find.mockResolvedValue([
        makeBooking({
          id: 'cash-1',
          stayId: 's1',
          paymentMethod: 'cash',
          totalAmount: 100,
          status: 'booked',
        }),
        makeBooking({
          id: 'rc-unsettled',
          stayId: 's2',
          paymentMethod: 'room_charge',
          totalAmount: 60,
          settledAt: null,
          status: 'booked',
        }),
        makeBooking({
          id: 'rc-settled',
          stayId: 's3',
          paymentMethod: 'room_charge',
          totalAmount: 40,
          settledAt: new Date(),
          status: 'booked',
        }),
        makeBooking({
          id: 'cancelled-cash',
          stayId: 's4',
          paymentMethod: 'cash',
          totalAmount: 999,
          status: 'cancelled',
        }),
      ]);
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 's1' }),
        makeStay({ id: 's2' }),
        makeStay({ id: 's3' }),
        makeStay({ id: 's4' }),
      ]);

      const result = await service.list(actor, 'event-1');

      expect(result.totals.expectedCash).toBe(100);
      // Only the unsettled room-charge booking counts — settled money has
      // already posted to the folio (the F&B unsettledTotal precedent).
      expect(result.totals.expectedRoomCharge).toBe(60);
    });

    it('treats included (free) bookings as contributing zero to expected sums', async () => {
      events.findEvent.mockResolvedValue(makeEvent({ price: 0 }));
      bookingsRepo.find.mockResolvedValue([
        makeBooking({
          id: 'included-1',
          stayId: 's1',
          paymentMethod: null,
          included: true,
          totalAmount: 0,
          status: 'booked',
        }),
      ]);
      staysRepo.find.mockResolvedValue([makeStay({ id: 's1' })]);

      const result = await service.list(actor, 'event-1');

      expect(result.totals.booked).toBe(2);
      expect(result.totals.expectedCash).toBe(0);
      expect(result.totals.expectedRoomCharge).toBe(0);
    });
  });
});
