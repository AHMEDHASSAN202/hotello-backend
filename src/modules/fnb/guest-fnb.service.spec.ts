import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { FnbItem } from './fnb-item.entity';
import { FnbLocation } from './fnb-location.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';
import { GuestFnbService } from './guest-fnb.service';

const HOTEL = {
  id: 'hotel-1',
  timezone: 'Africa/Cairo',
  currency: 'EGP',
  roomChargeEnabled: true,
};

const makeStay = (o: Record<string, unknown> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    roomId: 'room-1',
    guestName: 'Ahmed Ali',
    language: 'ru',
    stayType: 'all_inclusive',
    status: 'active',
    room: { id: 'room-1', roomNumber: '304' },
    hotel: { ...HOTEL },
    ...o,
  }) as unknown as Stay;

const makeMenu = (o: Partial<FnbMenu> = {}): FnbMenu =>
  ({
    id: 'menu-1',
    hotelId: 'hotel-1',
    names: { ar: 'خدمة الغرف', en: 'In-Room Dining', ru: 'Обслуживание номеров' },
    descriptions: null,
    windows: [],
    defaultIncludedFor: [],
    prepSlaMinutes: 30,
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbMenu;

const makeSection = (o: Partial<FnbMenuSection> = {}): FnbMenuSection =>
  ({
    id: 'section-1',
    hotelId: 'hotel-1',
    menuId: 'menu-1',
    names: { ar: 'أطباق', en: 'Mains' },
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbMenuSection;

const makeItem = (o: Partial<FnbItem> = {}): FnbItem =>
  ({
    id: 'item-1',
    hotelId: 'hotel-1',
    menuId: 'menu-1',
    sectionId: 'section-1',
    names: { ar: 'برجر', en: 'Burger', ru: 'Бургер' },
    descriptions: null,
    photoKeys: null,
    price: 120,
    includedFor: null,
    variant: null,
    allowNotes: true,
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbItem;

/** A window that's guaranteed CLOSED at this moment in hotel time. */
const closedWindow = () => {
  const minutes = hotelLocalParts(HOTEL.timezone, new Date()).minutes;
  const hhmm = (m: number) => {
    const norm = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
  };
  return { start: hhmm(minutes + 60), end: hhmm(minutes + 120) };
};

describe('GuestFnbService (16.5/16.6)', () => {
  let service: GuestFnbService;
  let menusRepo: Record<string, jest.Mock>;
  let sectionsRepo: Record<string, jest.Mock>;
  let itemsRepo: Record<string, jest.Mock>;
  let locationsRepo: Record<string, jest.Mock>;
  let ordersRepo: Record<string, jest.Mock>;
  let linesRepo: Record<string, jest.Mock>;
  let access: { getAccessState: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let managerOrders: Record<string, jest.Mock>;
  let managerLines: Record<string, jest.Mock>;

  beforeEach(async () => {
    menusRepo = { find: jest.fn().mockResolvedValue([makeMenu()]) };
    sectionsRepo = { find: jest.fn().mockResolvedValue([makeSection()]) };
    itemsRepo = { find: jest.fn().mockResolvedValue([makeItem()]) };
    locationsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    ordersRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (o) => o),
    };
    linesRepo = { find: jest.fn().mockResolvedValue([]) };
    access = {
      getAccessState: jest.fn().mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['fnb', 'requests'],
      }),
    };
    auditLogs = { log: jest.fn() };

    managerOrders = {
      create: jest.fn((d) => ({ id: 'order-new', createdAt: new Date(), updatedAt: new Date(), ...d })),
      save: jest.fn(async (o) => o),
    };
    managerLines = {
      create: jest.fn((d) => ({ id: `line-${d.sortOrder}`, ...d })),
      save: jest.fn(async (rows) => rows),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === FnbOrder ? managerOrders : managerLines,
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestFnbService,
        { provide: getRepositoryToken(FnbMenu), useValue: menusRepo },
        { provide: getRepositoryToken(FnbMenuSection), useValue: sectionsRepo },
        { provide: getRepositoryToken(FnbItem), useValue: itemsRepo },
        { provide: getRepositoryToken(FnbLocation), useValue: locationsRepo },
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
        { provide: getRepositoryToken(FnbOrderLine), useValue: linesRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantAccessService, useValue: access },
        { provide: AuditLogsService, useValue: auditLogs },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, fallback: string) => fallback) },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestFnbService);
  });

  describe('getMenus (16.5 AC1, 16.4 AC2, 16.1 AC4)', () => {
    it('prices for THE guest stay type, localized to their language', async () => {
      menusRepo.find.mockResolvedValue([
        makeMenu({ defaultIncludedFor: ['all_inclusive'] }),
      ]);
      itemsRepo.find.mockResolvedValue([
        makeItem(), // inherits menu default → included for AI guest
        makeItem({ id: 'item-2', includedFor: [], names: { ar: 'ويسكي', en: 'Whiskey' } }),
      ]);
      const view = await service.getMenus(makeStay());
      expect(view.stayType).toEqual('all_inclusive');
      expect(view.currency).toEqual('EGP');
      const items = view.menus[0].sections[0].items;
      expect(items[0]).toMatchObject({
        name: 'Бургер', // ru localization
        included: true,
        unitPrice: 0,
      });
      // Always-paid override in the same seamless menu (16.2 AC3).
      expect(items[1]).toMatchObject({ included: false, unitPrice: 120 });
    });

    it('annotates closed menus but still lists them (browse, not orderable)', async () => {
      menusRepo.find.mockResolvedValue([makeMenu({ windows: [closedWindow()] })]);
      const view = await service.getMenus(makeStay());
      expect(view.menus[0].availability.available).toBe(false);
      expect(view.menus[0].availability.opensAt).toMatch(/^\d{2}:\d{2}$/);
    });

    it('payment methods follow the hotel room-charge setting (16.4 AC1/AC2)', async () => {
      const withCharge = await service.getMenus(makeStay());
      expect(withCharge.paymentMethods).toEqual(['cash', 'room_charge']);
      const noCharge = await service.getMenus(
        makeStay({ hotel: { ...HOTEL, roomChargeEnabled: false } }),
      );
      expect(noCharge.paymentMethods).toEqual(['cash']);
    });

    it('module off → MODULE_NOT_ENABLED with module fnb', async () => {
      access.getAccessState.mockResolvedValue({
        hotelStatus: 'active',
        readOnly: false,
        enabledModules: ['requests'],
      });
      await expect(service.getMenus(makeStay())).rejects.toMatchObject({
        response: { code: 'MODULE_NOT_ENABLED', module: 'fnb' },
      });
    });
  });

  describe('createOrder (16.5 AC4/AC5, 16.4 AC3)', () => {
    const roomOrder = (lines = [{ itemId: 'item-1', quantity: 2 }]) =>
      ({
        lines,
        destination: { type: 'room' },
        paymentMethod: 'cash',
      }) as never;

    it('snapshots names (guest+ar+en), price, included flag; totals recomputed server-side', async () => {
      const view = await service.createOrder(makeStay(), roomOrder());
      expect(view.totalAmount).toBe(240);
      expect(view.roomNumber).toBe('304');
      const savedLines = managerLines.save.mock.calls[0][0];
      expect(managerLines.create).toHaveBeenCalledWith(
        expect.objectContaining({
          itemNames: { ar: 'برجر', en: 'Burger', ru: 'Бургер' },
          unitPrice: 120,
          included: false,
          lineTotal: 240,
        }),
      );
      expect(savedLines).toHaveLength(1);
      // View renders from the SNAPSHOT — later item edits change nothing.
      expect(view.lines[0].itemName).toEqual('Бургер');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fnb_order.created', actorId: null }),
      );
    });

    it('AC3 (16.4) — fully-included order stores paymentMethod NULL even if one was sent', async () => {
      itemsRepo.find.mockResolvedValue([
        makeItem({ includedFor: ['all_inclusive'] }),
      ]);
      const view = await service.createOrder(makeStay(), roomOrder());
      expect(view.totalAmount).toBe(0);
      expect(view.paymentMethod).toBeNull();
      expect(managerOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: null, totalAmount: 0 }),
      );
    });

    it('mixed cart: paid total counts only non-included lines', async () => {
      itemsRepo.find.mockResolvedValue([
        makeItem({ includedFor: ['all_inclusive'] }),
        makeItem({ id: 'item-2', includedFor: [], price: 75 }),
      ]);
      const view = await service.createOrder(
        makeStay(),
        roomOrder([
          { itemId: 'item-1', quantity: 3 },
          { itemId: 'item-2', quantity: 2 },
        ]),
      );
      expect(view.totalAmount).toBe(150);
      expect(view.lines.map((l) => l.included)).toEqual([true, false]);
    });

    it('paid total without a valid enabled method → FNB_PAYMENT_METHOD_INVALID', async () => {
      await expect(
        service.createOrder(makeStay(), {
          lines: [{ itemId: 'item-1', quantity: 1 }],
          destination: { type: 'room' },
        } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_PAYMENT_METHOD_INVALID' } });

      await expect(
        service.createOrder(
          makeStay({ hotel: { ...HOTEL, roomChargeEnabled: false } }),
          {
            lines: [{ itemId: 'item-1', quantity: 1 }],
            destination: { type: 'room' },
            paymentMethod: 'room_charge',
          } as never,
        ),
      ).rejects.toMatchObject({ response: { code: 'FNB_PAYMENT_METHOD_INVALID' } });
    });

    it('a just-closed menu → 409 MENU_UNAVAILABLE (server is the authority)', async () => {
      menusRepo.find.mockResolvedValue([makeMenu({ windows: [closedWindow()] })]);
      await expect(
        service.createOrder(makeStay(), roomOrder()),
      ).rejects.toMatchObject({
        response: { code: 'MENU_UNAVAILABLE', menuId: 'menu-1' },
      });
    });

    it('location destination snapshots names/key; spot kept only when hasSpots', async () => {
      locationsRepo.findOne.mockResolvedValue({
        id: 'loc-1',
        key: 'pool',
        names: { ar: 'المسبح', en: 'Pool' },
        hasSpots: true,
      });
      await service.createOrder(makeStay(), {
        lines: [{ itemId: 'item-1', quantity: 1 }],
        destination: { type: 'location', locationId: 'loc-1', spot: '12' },
        paymentMethod: 'cash',
      } as never);
      expect(managerOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationType: 'location',
          locationKey: 'pool',
          locationNames: { ar: 'المسبح', en: 'Pool' },
          spot: '12',
        }),
      );

      locationsRepo.findOne.mockResolvedValue({
        id: 'loc-2',
        key: 'lobby',
        names: { ar: 'اللوبي', en: 'Lobby' },
        hasSpots: false,
      });
      await service.createOrder(makeStay(), {
        lines: [{ itemId: 'item-1', quantity: 1 }],
        destination: { type: 'location', locationId: 'loc-2', spot: '9' },
        paymentMethod: 'cash',
      } as never);
      expect(managerOrders.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ locationKey: 'lobby', spot: null }),
      );
    });

    it('inactive/unknown location → FNB_LOCATION_INVALID', async () => {
      locationsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createOrder(makeStay(), {
          lines: [{ itemId: 'item-1', quantity: 1 }],
          destination: { type: 'location', locationId: 'loc-x' },
          paymentMethod: 'cash',
        } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_LOCATION_INVALID' } });
    });

    it('AC5 — open-orders and daily caps 429 with distinct codes', async () => {
      ordersRepo.count.mockResolvedValueOnce(5); // open cap (default 5)
      await expect(
        service.createOrder(makeStay(), roomOrder()),
      ).rejects.toMatchObject({ response: { code: 'FNB_LIMIT_OPEN', limit: 5 } });

      ordersRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
      await expect(
        service.createOrder(makeStay(), roomOrder()),
      ).rejects.toMatchObject({ response: { code: 'FNB_LIMIT_DAILY', limit: 20 } });
    });

    it('note on a notes-disabled item → FNB_NOTE_NOT_ALLOWED', async () => {
      itemsRepo.find.mockResolvedValue([makeItem({ allowNotes: false })]);
      await expect(
        service.createOrder(makeStay(), {
          lines: [{ itemId: 'item-1', quantity: 1, note: 'extra spicy' }],
          destination: { type: 'room' },
          paymentMethod: 'cash',
        } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_NOTE_NOT_ALLOWED' } });
    });

    it('unknown item (or cross-tenant — same 404) and disabled chain', async () => {
      itemsRepo.find.mockResolvedValue([]);
      await expect(
        service.createOrder(makeStay(), roomOrder()),
      ).rejects.toMatchObject({ response: { code: 'FNB_ITEM_NOT_FOUND' } });
      expect(itemsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: 'hotel-1' }),
        }),
      );

      itemsRepo.find.mockResolvedValue([makeItem()]);
      sectionsRepo.find.mockResolvedValue([makeSection({ isActive: false })]);
      await expect(
        service.createOrder(makeStay(), roomOrder()),
      ).rejects.toMatchObject({ response: { code: 'FNB_ITEM_DISABLED' } });
    });

    it('variant line snapshots the option and uses its absolute price', async () => {
      itemsRepo.find.mockResolvedValue([
        makeItem({
          variant: {
            label: { ar: 'الحجم', en: 'Size' },
            options: [
              { key: 'medium', names: { ar: 'وسط', en: 'Medium' }, price: 80 },
              { key: 'large', names: { ar: 'كبير', en: 'Large' }, price: 110 },
            ],
          },
        }),
      ]);
      const view = await service.createOrder(makeStay(), {
        lines: [{ itemId: 'item-1', variantKey: 'large', quantity: 1 }],
        destination: { type: 'room' },
        paymentMethod: 'cash',
      } as never);
      expect(view.totalAmount).toBe(110);
      expect(managerLines.create).toHaveBeenCalledWith(
        expect.objectContaining({
          variantKey: 'large',
          variantOptionNames: { ar: 'كبير', en: 'Large' },
          unitPrice: 110,
        }),
      );
    });
  });

  describe('listForStay + cancel (16.6)', () => {
    it('delta contract: updatedSince narrows to the stay + serverTime present', async () => {
      const res = await service.listForStay(makeStay(), {
        updatedSince: '2026-08-22T10:00:00.000Z',
      } as never);
      expect(res.serverTime).toBeDefined();
      const where = ordersRepo.find.mock.calls[0][0].where;
      expect(where.stayId).toEqual('stay-1');
      expect(where.updatedAt).toBeDefined();
    });

    it('cancel allowed while new only; scoped to the stay (404 otherwise)', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelOwn(makeStay(), 'o-1')).rejects.toMatchObject({
        response: { code: 'FNB_ORDER_NOT_FOUND' },
      });
      expect(ordersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'o-1', stayId: 'stay-1' },
      });

      ordersRepo.findOne.mockResolvedValue({
        id: 'o-1',
        stayId: 'stay-1',
        status: 'preparing',
      });
      await expect(service.cancelOwn(makeStay(), 'o-1')).rejects.toMatchObject({
        response: { code: 'FNB_ORDER_INVALID_STATUS', status: 'preparing' },
      });

      ordersRepo.findOne.mockResolvedValue({
        id: 'o-1',
        stayId: 'stay-1',
        status: 'new',
        locationNames: null,
        lines: [],
      });
      const view = await service.cancelOwn(makeStay(), 'o-1');
      expect(view.status).toEqual('cancelled');
      expect(view.cancelledReason).toEqual('guest');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fnb_order.cancelled' }),
      );
    });

    it('never pushes (23.4 recorded decision) — GuestFnbService takes no PushService dependency, so a guest-initiated cancel structurally cannot notify; the guest already knows, they did it', () => {
      // The push hooks added for Epic 23.4 live only on the STAFF-side
      // TenantFnbOrdersService.cancel() (tenant-fnb-orders.service.spec.ts).
      // This service is never given a `push` field/dependency, so cancelOwn
      // (or any other guest method) has no way to call PushService.notify.
      expect((service as unknown as Record<string, unknown>).push).toBeUndefined();
    });
  });
});
