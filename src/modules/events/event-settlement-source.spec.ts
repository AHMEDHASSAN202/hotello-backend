import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { EventBooking } from './event-booking.entity';
import { EventSettlementSource } from './event-settlement-source';

const HOTEL_ID = 'hotel-1';
const STAY_ID = 'stay-1';

const makeBooking = (o: Partial<EventBooking> = {}): EventBooking =>
  ({
    id: 'booking-1',
    hotelId: HOTEL_ID,
    stayId: STAY_ID,
    status: 'booked',
    paymentMethod: 'room_charge',
    totalAmount: 50,
    settledAt: null,
    settledById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...o,
  }) as EventBooking;

describe('EventSettlementSource.findUnsettledByStay (Story 22.4 AC1/AC4)', () => {
  let source: EventSettlementSource;
  let bookingsRepo: { find: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    bookingsRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventSettlementSource,
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
      ],
    }).compile();
    source = moduleRef.get(EventSettlementSource);
  });

  it('parity with findUnsettled: same eligible lines returned for a single stay', async () => {
    const eligible = makeBooking({ id: 'booking-eligible', totalAmount: 50 });
    const wrongPayment = makeBooking({
      id: 'booking-cash',
      paymentMethod: 'cash',
    });
    const noPayment = makeBooking({
      id: 'booking-nopay',
      paymentMethod: null,
    });
    const cancelled = makeBooking({
      id: 'booking-cancelled',
      status: 'cancelled',
    });
    const alreadySettled = makeBooking({
      id: 'booking-settled',
      settledAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const rows = [eligible, wrongPayment, noPayment, cancelled, alreadySettled];
    bookingsRepo.find.mockResolvedValue(rows);

    const viaFindUnsettled = await source.findUnsettled(HOTEL_ID, STAY_ID);
    const viaBulk = await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

    const bulkLines = viaBulk.get(STAY_ID) ?? [];
    expect(bulkLines.map((l) => ({ id: l.id, totalAmount: l.totalAmount }))).toEqual(
      viaFindUnsettled.map((l) => ({ id: l.id, totalAmount: l.totalAmount })),
    );
    expect(viaFindUnsettled.map((l) => l.id)).toEqual(['booking-eligible']);
  });

  it('groups multiple stays correctly, omitting stays with zero eligible lines', async () => {
    const stay1Eligible = makeBooking({
      id: 'booking-1',
      stayId: 'stay-1',
      totalAmount: 10,
    });
    const stay1Ineligible = makeBooking({
      id: 'booking-2',
      stayId: 'stay-1',
      paymentMethod: 'cash',
    });
    const stay2Eligible1 = makeBooking({
      id: 'booking-3',
      stayId: 'stay-2',
      totalAmount: 20,
    });
    const stay2Eligible2 = makeBooking({
      id: 'booking-4',
      stayId: 'stay-2',
      totalAmount: 30,
    });
    const stay3AllIneligible = makeBooking({
      id: 'booking-5',
      stayId: 'stay-3',
      status: 'cancelled',
    });
    bookingsRepo.find.mockResolvedValue([
      stay1Eligible,
      stay1Ineligible,
      stay2Eligible1,
      stay2Eligible2,
      stay3AllIneligible,
    ]);

    const map = await source.findUnsettledByStay(HOTEL_ID, [
      'stay-1',
      'stay-2',
      'stay-3',
    ]);

    expect([...map.keys()].sort()).toEqual(['stay-1', 'stay-2']);
    expect(map.has('stay-3')).toBe(false);
    expect(map.get('stay-1')?.map((l) => l.id)).toEqual(['booking-1']);
    expect(map.get('stay-2')?.map((l) => l.id)).toEqual(['booking-3', 'booking-4']);
  });

  it('passing stayIds narrows the repo query with In([...])', async () => {
    bookingsRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID, ['stay-a', 'stay-b']);

    expect(bookingsRepo.find).toHaveBeenCalledWith({
      where: { hotelId: HOTEL_ID, stayId: In(['stay-a', 'stay-b']) },
    });
  });

  it('omitting stayIds queries by hotelId only, with no stayId key', async () => {
    bookingsRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID);

    const callArgs = bookingsRepo.find.mock.calls[0][0];
    expect(callArgs.where).toEqual({ hotelId: HOTEL_ID });
    expect(Object.prototype.hasOwnProperty.call(callArgs.where, 'stayId')).toBe(
      false,
    );
  });

  it('carries createdAt through unchanged', async () => {
    const createdAt = new Date('2026-03-15T12:30:00.000Z');
    bookingsRepo.find.mockResolvedValue([
      makeBooking({ id: 'booking-1', createdAt }),
    ]);

    const map = await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

    expect(map.get(STAY_ID)?.[0].createdAt).toBe(createdAt);
  });

  it('hotelId isolation: the repo query is scoped by hotelId', async () => {
    bookingsRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

    const callArgs = bookingsRepo.find.mock.calls[0][0];
    expect(callArgs.where.hotelId).toBe(HOTEL_ID);
  });
});
