import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventBooking } from '../events/event-booking.entity';
import { EventSettlementSource } from '../events/event-settlement-source';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { FnbSettlementSource } from '../fnb/fnb-settlement-source';
import { TenantStaysService } from '../tenant-stays/tenant-stays.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { SETTLEMENT_SOURCES } from './settlement-source.interface';
import { StaySettlementService } from './stay-settlement.service';

const HOTEL_ID = 'hotel-1';
const STAY_ID = 'stay-1';
const actor = {
  id: 'user-1',
  hotelId: HOTEL_ID,
  name: 'Front Desk',
} as unknown as TenantUser;

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
    ...o,
  }) as FnbOrder;

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
    ...o,
  }) as EventBooking;

describe('StaySettlementService (Story 21.6 AC2)', () => {
  let service: StaySettlementService;
  let fnbOrdersRepo: Record<string, jest.Mock>;
  let eventBookingsRepo: Record<string, jest.Mock>;
  let stays: { findStayInHotel: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    fnbOrdersRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (o) => o),
    };
    eventBookingsRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (o) => o),
    };
    stays = { findStayInHotel: jest.fn().mockResolvedValue({ id: STAY_ID }) };
    auditLogs = { log: jest.fn() };

    // Real FnbSettlementSource + EventSettlementSource wired to mocked
    // repos — exercises the actual eligibility filters (not stand-in
    // mocks), the same way the shared SETTLEMENT_SOURCES factory wires
    // them in StaySettlementModule.
    const moduleRef = await Test.createTestingModule({
      providers: [
        StaySettlementService,
        FnbSettlementSource,
        EventSettlementSource,
        { provide: getRepositoryToken(FnbOrder), useValue: fnbOrdersRepo },
        {
          provide: getRepositoryToken(EventBooking),
          useValue: eventBookingsRepo,
        },
        { provide: TenantStaysService, useValue: stays },
        { provide: AuditLogsService, useValue: auditLogs },
        {
          provide: SETTLEMENT_SOURCES,
          useFactory: (fnb: FnbSettlementSource, events: EventSettlementSource) => [
            fnb,
            events,
          ],
          inject: [FnbSettlementSource, EventSettlementSource],
        },
      ],
    }).compile();
    service = moduleRef.get(StaySettlementService);
  });

  describe('unsettledTotal (AC2)', () => {
    it('sums 2 unsettled fnb orders + 1 unsettled event booking with a byKey breakdown', async () => {
      fnbOrdersRepo.find.mockResolvedValue([
        makeFnbOrder({ id: 'fnb-1', totalAmount: 100 }),
        makeFnbOrder({ id: 'fnb-2', totalAmount: 60.5 }),
      ]);
      eventBookingsRepo.find.mockResolvedValue([
        makeBooking({ id: 'booking-1', totalAmount: 40 }),
      ]);

      const res = await service.unsettledTotal(actor, STAY_ID);

      expect(res.total).toBe(200.5);
      expect(res.byKey).toEqual({ fnb: 160.5, events: 40 });
      expect(stays.findStayInHotel).toHaveBeenCalledWith(HOTEL_ID, STAY_ID);
    });

    it('a cancelled event booking with room_charge is excluded even before settling', async () => {
      fnbOrdersRepo.find.mockResolvedValue([]);
      eventBookingsRepo.find.mockResolvedValue([
        makeBooking({
          id: 'booking-cancelled',
          status: 'cancelled',
          totalAmount: 999,
        }),
      ]);

      const res = await service.unsettledTotal(actor, STAY_ID);

      expect(res.total).toBe(0);
      expect(res.byKey).toEqual({ fnb: 0, events: 0 });
    });

    it('cross-tenant stay id 404s via findStayInHotel before either source is queried', async () => {
      stays.findStayInHotel.mockRejectedValue(
        new NotFoundException({ code: 'STAY_NOT_FOUND' }),
      );

      await expect(
        service.unsettledTotal(actor, 'stay-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fnbOrdersRepo.find).not.toHaveBeenCalled();
      expect(eventBookingsRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('settle (AC2)', () => {
    it('marks all unsettled fnb orders + event bookings settled, audits once, idempotent', async () => {
      const fnbOrder1 = makeFnbOrder({ id: 'fnb-1', totalAmount: 100 });
      const fnbOrder2 = makeFnbOrder({ id: 'fnb-2', totalAmount: 60.5 });
      const booking1 = makeBooking({ id: 'booking-1', totalAmount: 40 });
      fnbOrdersRepo.find.mockResolvedValueOnce([fnbOrder1, fnbOrder2]);
      eventBookingsRepo.find.mockResolvedValueOnce([booking1]);

      const res = await service.settle(actor, STAY_ID);

      expect(res).toEqual({ settled: 3, unsettledTotal: 0 });
      expect(fnbOrdersRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'fnb-1',
          settledAt: expect.any(Date),
          settledById: 'user-1',
        }),
        expect.objectContaining({
          id: 'fnb-2',
          settledAt: expect.any(Date),
          settledById: 'user-1',
        }),
      ]);
      expect(eventBookingsRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'booking-1',
          settledAt: expect.any(Date),
          settledById: 'user-1',
        }),
      ]);
      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay_settlement.settled',
          entityType: 'stay',
          entityId: STAY_ID,
          actorId: 'user-1',
          metadata: expect.objectContaining({
            hotelId: HOTEL_ID,
            breakdown: {
              fnb: { count: 2, total: 160.5 },
              events: { count: 1, total: 40 },
            },
          }),
        }),
      );

      // Second call: nothing left unsettled → idempotent, settles 0.
      jest.clearAllMocks();
      fnbOrdersRepo.find.mockResolvedValueOnce([]);
      eventBookingsRepo.find.mockResolvedValueOnce([]);
      const again = await service.settle(actor, STAY_ID);
      expect(again).toEqual({ settled: 0, unsettledTotal: 0 });
    });

    it('cross-tenant stay id 404s via findStayInHotel before either source is queried', async () => {
      stays.findStayInHotel.mockRejectedValue(
        new NotFoundException({ code: 'STAY_NOT_FOUND' }),
      );

      await expect(service.settle(actor, 'stay-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fnbOrdersRepo.find).not.toHaveBeenCalled();
      expect(eventBookingsRepo.find).not.toHaveBeenCalled();
    });
  });
});
