import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { FnbOrder } from './fnb-order.entity';
import { FnbSettlementSource } from './fnb-settlement-source';

const HOTEL_ID = 'hotel-1';
const STAY_ID = 'stay-1';

const makeFnbOrder = (o: Partial<FnbOrder> = {}): FnbOrder =>
  ({
    id: 'fnb-1',
    hotelId: HOTEL_ID,
    stayId: STAY_ID,
    status: 'delivered',
    paymentMethod: 'room_charge',
    totalAmount: 100,
    settledAt: null,
    settledById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...o,
  }) as FnbOrder;

describe('FnbSettlementSource.findUnsettledByStay (Story 22.4 AC1/AC4)', () => {
  let source: FnbSettlementSource;
  let ordersRepo: { find: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    ordersRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FnbSettlementSource,
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
      ],
    }).compile();
    source = moduleRef.get(FnbSettlementSource);
  });

  it('parity with findUnsettled: same eligible lines returned for a single stay', async () => {
    const eligible = makeFnbOrder({ id: 'fnb-eligible', totalAmount: 100 });
    const wrongPayment = makeFnbOrder({
      id: 'fnb-cash',
      paymentMethod: 'cash',
    });
    const cancelled = makeFnbOrder({
      id: 'fnb-cancelled',
      status: 'cancelled',
    });
    const alreadySettled = makeFnbOrder({
      id: 'fnb-settled',
      settledAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const rows = [eligible, wrongPayment, cancelled, alreadySettled];
    ordersRepo.find.mockResolvedValue(rows);

    const viaFindUnsettled = await source.findUnsettled(HOTEL_ID, STAY_ID);
    const viaBulk = await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

    const bulkLines = viaBulk.get(STAY_ID) ?? [];
    expect(bulkLines.map((l) => ({ id: l.id, totalAmount: l.totalAmount }))).toEqual(
      viaFindUnsettled.map((l) => ({ id: l.id, totalAmount: l.totalAmount })),
    );
    expect(viaFindUnsettled.map((l) => l.id)).toEqual(['fnb-eligible']);
  });

  it('groups multiple stays correctly, omitting stays with zero eligible lines', async () => {
    const stay1Eligible = makeFnbOrder({
      id: 'fnb-1',
      stayId: 'stay-1',
      totalAmount: 10,
    });
    const stay1Ineligible = makeFnbOrder({
      id: 'fnb-2',
      stayId: 'stay-1',
      paymentMethod: 'cash',
    });
    const stay2Eligible1 = makeFnbOrder({
      id: 'fnb-3',
      stayId: 'stay-2',
      totalAmount: 20,
    });
    const stay2Eligible2 = makeFnbOrder({
      id: 'fnb-4',
      stayId: 'stay-2',
      totalAmount: 30,
    });
    const stay3AllIneligible = makeFnbOrder({
      id: 'fnb-5',
      stayId: 'stay-3',
      status: 'cancelled',
    });
    ordersRepo.find.mockResolvedValue([
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
    expect(map.get('stay-1')?.map((l) => l.id)).toEqual(['fnb-1']);
    expect(map.get('stay-2')?.map((l) => l.id)).toEqual(['fnb-3', 'fnb-4']);
  });

  it('passing stayIds narrows the repo query with In([...])', async () => {
    ordersRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID, ['stay-a', 'stay-b']);

    expect(ordersRepo.find).toHaveBeenCalledWith({
      where: { hotelId: HOTEL_ID, stayId: In(['stay-a', 'stay-b']) },
    });
  });

  it('omitting stayIds queries by hotelId only, with no stayId key', async () => {
    ordersRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID);

    const callArgs = ordersRepo.find.mock.calls[0][0];
    expect(callArgs.where).toEqual({ hotelId: HOTEL_ID });
    expect(Object.prototype.hasOwnProperty.call(callArgs.where, 'stayId')).toBe(
      false,
    );
  });

  it('applies fromNaive() to recover the true instant (Epic 22 final review, C1)', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Africa/Cairo';
    try {
      // Simulates what pg actually returns for a naive `timestamp` column:
      // the wall-clock digits as written (UTC wall time), parsed as
      // host-local by the driver — i.e. constructed with the local Date
      // constructor, not an ISO-with-Z string.
      const pgReturned = new Date(2026, 2, 15, 12, 30, 0, 0);
      ordersRepo.find.mockResolvedValue([
        makeFnbOrder({ id: 'fnb-1', createdAt: pgReturned }),
      ]);

      const map = await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

      expect(map.get(STAY_ID)?.[0].createdAt.toISOString()).toBe(
        '2026-03-15T12:30:00.000Z',
      );
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('hotelId isolation: the repo query is scoped by hotelId', async () => {
    ordersRepo.find.mockResolvedValue([]);

    await source.findUnsettledByStay(HOTEL_ID, [STAY_ID]);

    const callArgs = ordersRepo.find.mock.calls[0][0];
    expect(callArgs.where.hotelId).toBe(HOTEL_ID);
  });
});
