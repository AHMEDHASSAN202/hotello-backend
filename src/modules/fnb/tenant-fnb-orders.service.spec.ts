import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantStaysService } from '../tenant-stays/tenant-stays.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbSettlementSource } from './fnb-settlement-source';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';
import { FNB_ORDER_STATUSES, FnbOrderStatus } from './fnb.constants';
import { TenantFnbOrdersService } from './tenant-fnb-orders.service';

const HOTEL_ID = 'hotel-1';
const actor = {
  id: 'user-1',
  hotelId: HOTEL_ID,
  name: 'Chef',
} as unknown as TenantUser;

const makeOrder = (o: Partial<FnbOrder> = {}): FnbOrder =>
  ({
    id: 'order-1',
    hotelId: HOTEL_ID,
    stayId: 'stay-1',
    roomId: 'room-1',
    roomNumber: '304',
    guestName: 'Ahmed Ali',
    guestLanguage: 'ru',
    stayType: 'all_inclusive',
    menuIds: ['menu-1'],
    destinationType: 'room',
    locationId: null,
    locationKey: null,
    locationNames: null,
    spot: null,
    paymentMethod: 'cash',
    totalAmount: 230,
    currency: 'EGP',
    status: 'new',
    slaTargetMinutes: 30,
    dueAt: new Date(Date.now() + 30 * 60_000),
    assignedToId: null,
    startedAt: null,
    outForDeliveryAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelledReason: null,
    cancelNote: null,
    settledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as FnbOrder;

describe('TenantFnbOrdersService (16.7/16.8)', () => {
  let service: TenantFnbOrdersService;
  let ordersRepo: Record<string, jest.Mock>;
  let linesRepo: Record<string, jest.Mock>;
  let usersRepo: Record<string, jest.Mock>;
  let hotelsRepo: Record<string, jest.Mock>;
  let stays: { findStayInHotel: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take', 'select', 'innerJoinAndSelect']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.getRawOne = jest.fn().mockResolvedValue({ sum: '0' });

    ordersRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (o) => o),
      createQueryBuilder: jest.fn(() => qb),
    };
    linesRepo = { find: jest.fn().mockResolvedValue([]) };
    usersRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => qb),
    };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({ id: HOTEL_ID, timezone: 'Africa/Cairo' }),
    };
    stays = { findStayInHotel: jest.fn().mockResolvedValue({ id: 'stay-1' }) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantFnbOrdersService,
        // Real FnbSettlementSource sharing the same mocked orders repo —
        // TenantFnbOrdersService now delegates settlement queries/mutations
        // to it (Story 21.6 AC2), so this is the same repo mock either way.
        FnbSettlementSource,
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
        { provide: getRepositoryToken(FnbOrderLine), useValue: linesRepo },
        { provide: getRepositoryToken(TenantUser), useValue: usersRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: TenantStaysService, useValue: stays },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantFnbOrdersService);
  });

  describe('transition matrix (AC2/AC4)', () => {
    const actions: Array<{
      run: (id: string) => Promise<unknown>;
      target: FnbOrderStatus;
      allowedFrom: FnbOrderStatus[];
      audit: string;
    }> = [
      {
        run: (id) => service.start(actor, id),
        target: 'preparing',
        allowedFrom: ['new'],
        audit: 'fnb_order.started',
      },
      {
        run: (id) => service.outForDelivery(actor, id),
        target: 'on_the_way',
        allowedFrom: ['preparing'],
        audit: 'fnb_order.out_for_delivery',
      },
      {
        run: (id) => service.deliver(actor, id),
        target: 'delivered',
        allowedFrom: ['on_the_way'],
        audit: 'fnb_order.delivered',
      },
      {
        run: (id) =>
          service.cancel(actor, id, { reason: 'out_of_stock' } as never),
        target: 'cancelled',
        allowedFrom: ['new', 'preparing'],
        audit: 'fnb_order.cancelled',
      },
    ];

    it('every action × every status behaves per the map', async () => {
      for (const action of actions) {
        for (const status of FNB_ORDER_STATUSES) {
          jest.clearAllMocks();
          ordersRepo.findOne.mockResolvedValue(makeOrder({ status }));
          if (action.allowedFrom.includes(status)) {
            await action.run('order-1');
            expect(ordersRepo.save).toHaveBeenCalledWith(
              expect.objectContaining({ status: action.target }),
            );
            expect(auditLogs.log).toHaveBeenCalledWith(
              expect.objectContaining({ action: action.audit }),
            );
          } else {
            await expect(action.run('order-1')).rejects.toMatchObject({
              response: { code: 'FNB_ORDER_INVALID_STATUS', status },
            });
            expect(ordersRepo.save).not.toHaveBeenCalled();
          }
        }
      }
    });

    it('start claims an unowned ticket for the actor', async () => {
      ordersRepo.findOne.mockResolvedValue(makeOrder());
      await service.start(actor, 'order-1');
      expect(ordersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ assignedToId: 'user-1', startedById: 'user-1' }),
      );
    });

    it('cross-tenant orders 404 (isolation)', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await expect(service.start(actor, 'order-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ordersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'order-x', hotelId: HOTEL_ID },
      });
    });
  });

  describe('assignment (AC2)', () => {
    it('validates the target grants fnb_orders.update else 422', async () => {
      ordersRepo.findOne.mockResolvedValue(makeOrder());
      usersRepo.findOne.mockResolvedValue({
        id: 'user-2',
        status: 'active',
        role: { permissions: ['fnb_orders.read'] },
      });
      await expect(
        service.assign(actor, 'order-1', { assigneeId: 'user-2' } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_ASSIGNEE_INVALID' } });

      usersRepo.findOne.mockResolvedValue({
        id: 'user-2',
        status: 'active',
        role: { permissions: ['fnb_orders.update'] },
      });
      await service.assign(actor, 'order-1', { assigneeId: 'user-2' } as never);
      expect(ordersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ assignedToId: 'user-2' }),
      );
    });

    it('null unassigns', async () => {
      ordersRepo.findOne.mockResolvedValue(makeOrder({ assignedToId: 'user-2' }));
      await service.assign(actor, 'order-1', { assigneeId: null } as never);
      expect(ordersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ assignedToId: null }),
      );
    });
  });

  describe('board list (AC1/AC3)', () => {
    it('delta mode drops the status filter so finalized rows flow out', async () => {
      await service.list(actor, {
        tab: 'open',
        updatedSince: '2026-08-22T10:00:00.000Z',
      } as never);
      const where = ordersRepo.find.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
      expect(where.updatedAt).toBeDefined();
      expect(where.hotelId).toEqual(HOTEL_ID);
    });

    it('overdue=1 filters open orders past dueAt server-side', async () => {
      await service.list(actor, { tab: 'open', overdue: '1' } as never);
      const where = ordersRepo.find.mock.calls[0][0].where;
      expect(where.dueAt).toBeDefined();
    });

    it('destination filter: room vs a location id', async () => {
      await service.list(actor, { tab: 'open', destination: 'room' } as never);
      expect(ordersRepo.find.mock.calls[0][0].where.destinationType).toEqual('room');

      jest.clearAllMocks();
      hotelsRepo.findOne.mockResolvedValue({ id: HOTEL_ID, timezone: 'Africa/Cairo' });
      await service.list(actor, { tab: 'open', destination: 'loc-9' } as never);
      expect(ordersRepo.find.mock.calls[0][0].where.locationId).toEqual('loc-9');
    });

    it('menu filter narrows open-tab rows via the menuIds snapshot', async () => {
      ordersRepo.find.mockResolvedValue([
        makeOrder({ id: 'a', menuIds: ['menu-1'] }),
        makeOrder({ id: 'b', menuIds: ['menu-2'] }),
      ]);
      const res = (await service.list(actor, {
        tab: 'open',
        menuId: 'menu-2',
      } as never)) as unknown as { data: Array<{ id: string }> };
      expect(res.data.map((o) => o.id)).toEqual(['b']);
    });

    it('counts include paid revenue today (AC3 — the owner number)', async () => {
      qb.getRawOne.mockResolvedValue({ sum: '460.50' });
      const counts = await service.counts(HOTEL_ID);
      expect(counts.revenueToday).toBe(460.5);
      expect(counts).toEqual(
        expect.objectContaining({ open: 0, deliveredToday: 0, overdueNow: 0 }),
      );
    });

    it('views localize lines to guest language with ar/en for the board', async () => {
      ordersRepo.find.mockResolvedValue([makeOrder()]);
      linesRepo.find.mockResolvedValue([
        {
          id: 'line-1',
          orderId: 'order-1',
          itemNames: { ar: 'برجر', en: 'Burger', ru: 'Бургер' },
          variantOptionNames: null,
          quantity: 2,
          unitPrice: 115,
          included: false,
          lineTotal: 230,
          note: 'без лука',
          sortOrder: 0,
        },
      ]);
      const res = (await service.list(actor, {
        tab: 'open',
      } as never)) as unknown as {
        data: Array<{ lines: Array<Record<string, unknown>> }>;
      };
      expect(res.data[0].lines[0]).toMatchObject({
        itemNameEn: 'Burger',
        itemNameAr: 'برجر',
        itemName: 'Бургер',
        note: 'без лука',
      });
    });
  });

  describe('settlement (16.8)', () => {
    it('AC2 — settles delivered room-charge unsettled orders, audits once, idempotent', async () => {
      const settleable = makeOrder({
        id: 'o-rc',
        status: 'delivered',
        paymentMethod: 'room_charge',
        totalAmount: 460,
      });
      ordersRepo.find
        .mockResolvedValueOnce([settleable]) // to settle
        .mockResolvedValueOnce([{ ...settleable, settledAt: new Date() }]); // remaining
      const res = await service.settleStayOrders(actor, 'stay-1', {} as never);
      expect(res.settled).toBe(1);
      expect(res.unsettledTotal).toBe(0);
      const where = ordersRepo.find.mock.calls[0][0].where;
      expect(where).toMatchObject({
        hotelId: HOTEL_ID,
        stayId: 'stay-1',
        status: 'delivered',
        paymentMethod: 'room_charge',
      });
      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fnb_orders.settled',
          metadata: expect.objectContaining({ orderIds: ['o-rc'], total: 460 }),
        }),
      );

      // Second call: nothing matches → zero settled, no audit.
      jest.clearAllMocks();
      ordersRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const again = await service.settleStayOrders(actor, 'stay-1', {} as never);
      expect(again.settled).toBe(0);
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('AC1 — unsettledTotal sums only delivered unsettled room-charge orders', async () => {
      ordersRepo.find.mockResolvedValue([
        makeOrder({ id: 'a', status: 'delivered', paymentMethod: 'room_charge', totalAmount: 200 }),
        makeOrder({ id: 'b', status: 'delivered', paymentMethod: 'room_charge', totalAmount: 260, settledAt: new Date() }),
        makeOrder({ id: 'c', status: 'delivered', paymentMethod: 'cash', totalAmount: 90 }),
        makeOrder({ id: 'd', status: 'preparing', paymentMethod: 'room_charge', totalAmount: 55 }),
      ]);
      const res = await service.stayOrders(actor, 'stay-1');
      expect(res.unsettledTotal).toBe(200);
      expect(res.data).toHaveLength(4);
    });

    it('stay resolution goes through the cross-tenant 404 chokepoint', async () => {
      stays.findStayInHotel.mockRejectedValue(
        new NotFoundException({ code: 'STAY_NOT_FOUND' }),
      );
      await expect(service.stayOrders(actor, 'stay-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(stays.findStayInHotel).toHaveBeenCalledWith(HOTEL_ID, 'stay-x');
      // Auto-checkout never touches settlement — closing a stay with
      // unsettled orders is a stays-module concern and stays non-blocking.
    });
  });
});
