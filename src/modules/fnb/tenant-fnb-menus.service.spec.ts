import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbItem } from './fnb-item.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { TenantFnbMenusService } from './tenant-fnb-menus.service';

const HOTEL_ID = 'hotel-1';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeMenu = (o: Partial<FnbMenu> = {}): FnbMenu =>
  ({
    id: 'menu-1',
    hotelId: HOTEL_ID,
    names: { ar: 'خدمة الغرف', en: 'In-Room Dining' },
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
    hotelId: HOTEL_ID,
    menuId: 'menu-1',
    names: { ar: 'مقبلات', en: 'Starters' },
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbMenuSection;

const makeItem = (o: Partial<FnbItem> = {}): FnbItem =>
  ({
    id: 'item-1',
    hotelId: HOTEL_ID,
    menuId: 'menu-1',
    sectionId: 'section-1',
    names: { ar: 'سلطة', en: 'Salad' },
    descriptions: null,
    photoKeys: null,
    price: 50,
    includedFor: null,
    variant: null,
    allowNotes: true,
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbItem;

describe('TenantFnbMenusService (16.2)', () => {
  let service: TenantFnbMenusService;
  let menusRepo: Record<string, jest.Mock>;
  let sectionsRepo: Record<string, jest.Mock>;
  let itemsRepo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    menusRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((d) => ({ id: 'menu-new', ...d })),
      save: jest.fn(async (m) => m),
    };
    sectionsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'section-new', ...d })),
      save: jest.fn(async (s) => s),
    };
    itemsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'item-new', ...d })),
      save: jest.fn(async (i) => i),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantFnbMenusService,
        { provide: getRepositoryToken(FnbMenu), useValue: menusRepo },
        { provide: getRepositoryToken(FnbMenuSection), useValue: sectionsRepo },
        { provide: getRepositoryToken(FnbItem), useValue: itemsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantFnbMenusService);
  });

  describe('createMenu (AC1)', () => {
    it('builds the 7-locale names map and audits creation', async () => {
      const view = await service.createMenu(actor, {
        nameEn: 'Pool Bar',
        nameAr: 'بار المسبح',
        nameRu: 'Бар у бассейна',
        prepSlaMinutes: 20,
        windows: [{ start: '10:00', end: '18:00' }],
        defaultIncludedFor: ['all_inclusive'],
      } as never);

      expect(view.names).toEqual({
        en: 'Pool Bar',
        ar: 'بار المسبح',
        ru: 'Бар у бассейна',
      });
      expect(view.windows).toEqual([{ start: '10:00', end: '18:00' }]);
      expect(view.defaultIncludedFor).toEqual(['all_inclusive']);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fnb_menu.created' }),
      );
    });

    it('AR + EN are required (FNB_NAMES_REQUIRED)', async () => {
      await expect(
        service.createMenu(actor, { nameEn: 'Pool Bar', nameAr: '' } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_NAMES_REQUIRED' } });
    });
  });

  describe('updateMenu', () => {
    it('cross-tenant menus 404 (isolation)', async () => {
      menusRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateMenu(actor, 'menu-other', { prepSlaMinutes: 20 } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(menusRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'menu-other', hotelId: HOTEL_ID },
      });
    });

    it('audits a field diff and never touches order rows (AC6)', async () => {
      menusRepo.findOne.mockResolvedValue(makeMenu());
      await service.updateMenu(actor, 'menu-1', { isActive: false } as never);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fnb_menu.updated',
          metadata: expect.objectContaining({
            diff: { isActive: { from: true, to: false } },
          }),
        }),
      );
    });

    it('no-op update saves and audits nothing', async () => {
      menusRepo.findOne.mockResolvedValue(makeMenu());
      await service.updateMenu(actor, 'menu-1', { prepSlaMinutes: 30 } as never);
      expect(menusRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  describe('sections', () => {
    it('createSection resolves the menu within the hotel first', async () => {
      menusRepo.findOne.mockResolvedValue(makeMenu());
      const view = await service.createSection(actor, 'menu-1', {
        nameEn: 'Starters',
        nameAr: 'مقبلات',
      } as never);
      expect(view.names).toEqual({ en: 'Starters', ar: 'مقبلات' });
      expect(sectionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ hotelId: HOTEL_ID, menuId: 'menu-1' }),
      );
    });

    it('cross-tenant sections 404', async () => {
      sectionsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSection(actor, 'section-x', { isActive: false } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_SECTION_NOT_FOUND' } });
    });
  });

  describe('items (AC2–AC5)', () => {
    it('creates an item with pricing mode + notes default on', async () => {
      sectionsRepo.findOne.mockResolvedValue(makeSection());
      const view = await service.createItem(actor, 'section-1', {
        nameEn: 'Greek Salad',
        nameAr: 'سلطة يونانية',
        price: 80,
        includedFor: [],
      } as never);
      expect(view.price).toBe(80);
      expect(view.includedFor).toEqual([]); // always-paid override
      expect(view.allowNotes).toBe(true);
      expect(itemsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ menuId: 'menu-1', sectionId: 'section-1' }),
      );
    });

    it('AC4 — variant options get stable, unique slug keys with absolute prices', async () => {
      sectionsRepo.findOne.mockResolvedValue(makeSection());
      const view = await service.createItem(actor, 'section-1', {
        nameEn: 'Fresh Juice',
        nameAr: 'عصير طازج',
        price: 40,
        variant: {
          nameEn: 'Size',
          nameAr: 'الحجم',
          options: [
            { nameEn: 'Medium', nameAr: 'وسط', price: 80 },
            { nameEn: 'Large', nameAr: 'كبير', price: 110 },
            { nameEn: 'Large', nameAr: 'كبير جدا', price: 130 },
          ],
        },
      } as never);
      expect(view.variant?.label).toEqual({ en: 'Size', ar: 'الحجم' });
      expect(view.variant?.options.map((o) => o.key)).toEqual([
        'medium',
        'large',
        'large-2',
      ]);
      expect(view.variant?.options.map((o) => o.price)).toEqual([80, 110, 130]);
    });

    it('update audits price + includedFor diffs', async () => {
      itemsRepo.findOne.mockResolvedValue(makeItem());
      await service.updateItem(actor, 'item-1', {
        price: 65,
        includedFor: ['all_inclusive'],
      } as never);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fnb_menu.updated',
          entityType: 'fnb_item',
          metadata: expect.objectContaining({
            diff: {
              price: { from: 50, to: 65 },
              includedFor: { from: null, to: ['all_inclusive'] },
            },
          }),
        }),
      );
    });

    it('cross-tenant items 404', async () => {
      itemsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateItem(actor, 'item-x', { price: 10 } as never),
      ).rejects.toMatchObject({ response: { code: 'FNB_ITEM_NOT_FOUND' } });
    });
  });

  describe('getTree', () => {
    it('returns the full tree incl. inactive rows, sorted, with photo URLs', async () => {
      menusRepo.find.mockResolvedValue([
        makeMenu({ id: 'm2', sortOrder: 1, isActive: false }),
        makeMenu({ id: 'm1', sortOrder: 0 }),
      ]);
      sectionsRepo.find.mockResolvedValue([
        makeSection({ id: 's1', menuId: 'm1' }),
      ]);
      itemsRepo.find.mockResolvedValue([
        makeItem({
          id: 'i1',
          sectionId: 's1',
          photoKeys: { thumb: 'fnb/h/i/x-thumb.webp', detail: 'fnb/h/i/x-detail.webp' },
        }),
      ]);
      const tree = await service.getTree(actor);
      expect(tree.menus.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(tree.menus[1].isActive).toBe(false);
      expect(tree.menus[0].sections[0].items[0].photoThumbUrl).toEqual(
        'files/fnb/h/i/x-thumb.webp',
      );
    });
  });
});
