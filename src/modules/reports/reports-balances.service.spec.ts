import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { StaySettlementService } from '../stay-settlement/stay-settlement.service';
import { Room } from '../tenant-rooms/room.entity';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { ReportsBalancesService } from './reports-balances.service';

const HOTEL_ID = 'hotel-1';

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: HOTEL_ID,
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    ...o,
  }) as Hotel;

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: HOTEL_ID,
    roomId: 'room-1',
    guestName: 'Guest',
    checkOutDate: '2026-03-10',
    status: 'active',
    checkoutType: null,
    checkedOutAt: null,
    ...o,
  }) as Stay;

const makeRoom = (o: Partial<Room> = {}): Room =>
  ({
    id: 'room-1',
    roomNumber: '101',
    ...o,
  }) as Room;

describe('ReportsBalancesService (Story 22.4)', () => {
  let service: ReportsBalancesService;
  let staysRepo: { find: jest.Mock };
  let roomsRepo: { find: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let staySettlement: { unsettledByStay: jest.Mock };

  beforeEach(async () => {
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    roomsRepo = { find: jest.fn().mockResolvedValue([]) };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    staySettlement = { unsettledByStay: jest.fn().mockResolvedValue(new Map()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsBalancesService,
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: StaySettlementService, useValue: staySettlement },
      ],
    }).compile();
    service = moduleRef.get(ReportsBalancesService);
  });

  describe('balances', () => {
    it('1. is empty when unsettledByStay returns an empty Map', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(new Map());

      const res = await service.balances(HOTEL_ID);

      expect(res).toEqual({
        currency: 'EGP',
        departingTodayCount: 0,
        departingTodayTotal: 0,
        totalOutstanding: 0,
        rows: [],
      });
    });

    it('2. excludes a stay that is not status active even though it has an unsettled summary', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([
          ['stay-checked-out', { total: 100, byKey: { fnb: 100 }, oldestUnsettledAt: new Date() }],
        ]),
      );
      // Simulates the `status: 'active'` filter excluding the stay.
      staysRepo.find.mockResolvedValue([]);

      const res = await service.balances(HOTEL_ID);

      expect(res.rows).toEqual([]);
      expect(res.totalOutstanding).toBe(0);
    });

    it('3. sorts rows by checkOutDate ascending', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([
          ['stay-b', { total: 10, byKey: { fnb: 10 }, oldestUnsettledAt: new Date() }],
          ['stay-a', { total: 20, byKey: { fnb: 20 }, oldestUnsettledAt: new Date() }],
          ['stay-c', { total: 30, byKey: { fnb: 30 }, oldestUnsettledAt: new Date() }],
        ]),
      );
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'stay-b', checkOutDate: '2026-03-15' }),
        makeStay({ id: 'stay-a', checkOutDate: '2026-03-05' }),
        makeStay({ id: 'stay-c', checkOutDate: '2026-03-20' }),
      ]);
      roomsRepo.find.mockResolvedValue([makeRoom()]);

      const res = await service.balances(HOTEL_ID);

      expect(res.rows.map((r) => r.stayId)).toEqual(['stay-a', 'stay-b', 'stay-c']);
    });

    it('4. computes departsToday/header stats using the real hotel-local date for a fixed now', async () => {
      const now = new Date('2026-03-10T08:00:00Z');
      const today = hotelLocalParts('Africa/Cairo', now).date;
      const otherDate = '2026-03-01';

      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([
          ['stay-today', { total: 50, byKey: { fnb: 50 }, oldestUnsettledAt: new Date() }],
          ['stay-other', { total: 75, byKey: { fnb: 75 }, oldestUnsettledAt: new Date() }],
        ]),
      );
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'stay-today', checkOutDate: today }),
        makeStay({ id: 'stay-other', checkOutDate: otherDate }),
      ]);
      roomsRepo.find.mockResolvedValue([makeRoom()]);

      const res = await service.balances(HOTEL_ID, now);

      expect(res.departingTodayCount).toBe(1);
      expect(res.departingTodayTotal).toBe(50);
      const todayRow = res.rows.find((r) => r.stayId === 'stay-today')!;
      const otherRow = res.rows.find((r) => r.stayId === 'stay-other')!;
      expect(todayRow.departsToday).toBe(true);
      expect(otherRow.departsToday).toBe(false);
    });

    it('5. normalizes a byKey missing the events key to 0', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([['stay-1', { total: 100, byKey: { fnb: 100 }, oldestUnsettledAt: new Date() }]]),
      );
      staysRepo.find.mockResolvedValue([makeStay()]);
      roomsRepo.find.mockResolvedValue([makeRoom()]);

      const res = await service.balances(HOTEL_ID);

      expect(res.rows[0].byKey).toEqual({ fnb: 100, events: 0 });
    });

    it('6. rounds totalOutstanding to 2 decimals across all rows', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([
          ['stay-1', { total: 0.1, byKey: { fnb: 0.1 }, oldestUnsettledAt: new Date() }],
          ['stay-2', { total: 0.2, byKey: { fnb: 0.2 }, oldestUnsettledAt: new Date() }],
        ]),
      );
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'stay-1' }),
        makeStay({ id: 'stay-2' }),
      ]);
      roomsRepo.find.mockResolvedValue([makeRoom()]);

      const res = await service.balances(HOTEL_ID);

      expect(res.totalOutstanding).toBe(0.3);
    });

    it('7. falls back to an empty string roomNumber when the room is not found', async () => {
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([['stay-1', { total: 100, byKey: { fnb: 100 }, oldestUnsettledAt: new Date() }]]),
      );
      staysRepo.find.mockResolvedValue([makeStay({ roomId: 'room-missing' })]);
      // roomsRepo.find returns no matching room.
      roomsRepo.find.mockResolvedValue([]);

      const res = await service.balances(HOTEL_ID);

      expect(res.rows[0].roomNumber).toBe('');
    });
  });

  describe('leakage', () => {
    it('8. returns an empty report with a populated period when nothing checked out in range', async () => {
      staysRepo.find.mockResolvedValue([]);

      const res = await service.leakage(HOTEL_ID, { preset: 'today' } as any);

      expect(res.totalLost).toBe(0);
      expect(res.rows).toEqual([]);
      expect(res.period.preset).toBe('today');
      expect(res.period.from).toBeDefined();
      expect(res.period.to).toBeDefined();
      expect(res.period.days).toBe(1);
    });

    it('9. excludes a checked-out stay with no unsettled balance', async () => {
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'stay-1', status: 'checked_out', checkedOutAt: new Date(), checkoutType: 'manual' }),
      ]);
      staySettlement.unsettledByStay.mockResolvedValue(new Map());

      const res = await service.leakage(HOTEL_ID, { preset: 'today' } as any);

      expect(res.rows).toEqual([]);
      expect(res.totalLost).toBe(0);
    });

    it('10. carries checkoutType and checkedOutAt through unchanged', async () => {
      const checkedOutAt = new Date('2026-03-05T10:30:00Z');
      staysRepo.find.mockResolvedValue([
        makeStay({
          id: 'stay-1',
          status: 'checked_out',
          checkedOutAt,
          checkoutType: 'automatic',
        }),
      ]);
      staySettlement.unsettledByStay.mockResolvedValue(
        new Map([['stay-1', { total: 40, byKey: { fnb: 40 }, oldestUnsettledAt: checkedOutAt }]]),
      );
      roomsRepo.find.mockResolvedValue([makeRoom()]);

      const res = await service.leakage(HOTEL_ID, { preset: 'today' } as any);

      expect(res.rows[0].checkoutType).toBe('automatic');
      expect(res.rows[0].checkedOutAt).toBe(checkedOutAt.toISOString());
    });

    it('11. maps a ReportPeriodError to a BadRequestException with code REPORT_RANGE_INVALID', async () => {
      await expect(
        service.leakage(HOTEL_ID, { preset: 'custom' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      try {
        await service.leakage(HOTEL_ID, { preset: 'custom' } as any);
        fail('expected leakage to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({ code: 'REPORT_RANGE_INVALID' }),
        );
      }
    });

    it('12. resolves a valid preset and queries staysRepo.find with a Between(...) of Date instances', async () => {
      staysRepo.find.mockResolvedValue([]);

      await service.leakage(HOTEL_ID, { preset: 'last7' } as any);

      expect(staysRepo.find).toHaveBeenCalledTimes(1);
      const callArg = staysRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.status).toBe('checked_out');
      const betweenValue = callArg.where.checkedOutAt;
      expect(betweenValue).toEqual(
        Between(betweenValue._value[0], betweenValue._value[1]),
      );
      expect(betweenValue._value[0]).toBeInstanceOf(Date);
      expect(betweenValue._value[1]).toBeInstanceOf(Date);
    });
  });
});
