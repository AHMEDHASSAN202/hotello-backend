import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import { TenantRequestCatalogService } from './tenant-request-catalog.service';

const ACTOR = { id: 'user-1', hotelId: 'hotel-1' } as TenantUser;

const PLATFORM_ITEM = {
  item: {
    id: 'item-towels',
    categoryId: 'cat-1',
    hotelId: null,
    key: 'extra_towels',
    names: { ar: 'مناشف', en: 'Extra towels', ru: 'Полотенца' },
    descriptions: null,
    icon: 'layers',
    optionType: 'quantity',
    optionMin: 1,
    optionMax: 4,
    defaultSlaMinutes: 20,
    sortOrder: 1,
    isActive: true,
  },
  enabled: true,
  sortOrder: 1,
  slaMinutes: 20,
  categoryEnabled: true,
};

function makeCustomItem() {
  return {
    item: {
      id: 'item-custom',
      categoryId: 'cat-1',
      hotelId: 'hotel-1',
      key: null,
      names: { ar: 'خدمة خاصة', en: 'Special service' },
      descriptions: null,
      icon: 'star',
      optionType: null,
      optionMin: null,
      optionMax: null,
      defaultSlaMinutes: 30,
      sortOrder: 2,
      isActive: true,
    },
    enabled: true,
    sortOrder: 2,
    slaMinutes: 30,
    categoryEnabled: true,
  };
}

describe('TenantRequestCatalogService (15.1)', () => {
  let service: TenantRequestCatalogService;
  let categoriesRepo: { findOne: jest.Mock };
  let itemsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let categorySettingsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let itemSettingsRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let catalogView: { getEffectiveCatalog: jest.Mock; findItemForHotel: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    categoriesRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cat-1',
        key: 'housekeeping',
        names: { en: 'Housekeeping' },
        icon: 'sparkles',
        sortOrder: 0,
      }),
    };
    itemsRepo = {
      findOne: jest.fn(),
      create: jest.fn((d) => d),
      save: jest.fn(async (row) => ({ id: row.id ?? 'item-new', ...row })),
    };
    categorySettingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => d),
      save: jest.fn(async (row) => row),
    };
    itemSettingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => d),
      save: jest.fn(async (row) => row),
    };
    catalogView = {
      getEffectiveCatalog: jest.fn().mockResolvedValue([
        {
          category: {
            id: 'cat-1',
            key: 'housekeeping',
            names: { en: 'Housekeeping' },
            icon: 'sparkles',
          },
          enabled: true,
          items: [PLATFORM_ITEM, makeCustomItem()],
        },
      ]),
      findItemForHotel: jest.fn().mockResolvedValue(PLATFORM_ITEM),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRequestCatalogService,
        { provide: getRepositoryToken(RequestCategory), useValue: categoriesRepo },
        { provide: getRepositoryToken(RequestItem), useValue: itemsRepo },
        { provide: getRepositoryToken(HotelRequestCategorySetting), useValue: categorySettingsRepo },
        { provide: getRepositoryToken(HotelRequestItemSetting), useValue: itemSettingsRepo },
        { provide: RequestCatalogViewService, useValue: catalogView },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantRequestCatalogService);
  });

  describe('getCatalog', () => {
    it('marks custom items and exposes effective + default SLA', async () => {
      const result = await service.getCatalog(ACTOR);
      const [platform, custom] = result.categories[0].items;
      expect(platform).toMatchObject({ isCustom: false, slaMinutes: 20 });
      expect(custom).toMatchObject({ isCustom: true, key: null });
    });
  });

  describe('setCategoryEnabled (AC2)', () => {
    it('upserts the settings row and audits the diff (AC6)', async () => {
      await service.setCategoryEnabled(ACTOR, 'cat-1', false);
      expect(categorySettingsRepo.save.mock.calls[0][0]).toMatchObject({
        hotelId: 'hotel-1',
        categoryId: 'cat-1',
        enabled: false,
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'request_catalog.updated',
          metadata: expect.objectContaining({
            diff: { enabled: { from: true, to: false } },
          }),
        }),
      );
    });

    it('404 for an unknown category', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setCategoryEnabled(ACTOR, 'cat-x', false),
      ).rejects.toMatchObject({
        response: { code: 'REQUEST_CATEGORY_NOT_FOUND' },
      });
    });
  });

  describe('updateItem (AC2/AC4)', () => {
    it('enable/SLA curation writes the settings row, not the item', async () => {
      await service.updateItem(ACTOR, 'item-towels', {
        enabled: false,
        slaMinutes: 35,
      });
      expect(itemSettingsRepo.save.mock.calls[0][0]).toMatchObject({
        hotelId: 'hotel-1',
        itemId: 'item-towels',
        enabled: false,
        slaMinutes: 35,
      });
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('AC2 — platform translations are read-only: 403 CUSTOM_ITEM_ONLY', async () => {
      await expect(
        service.updateItem(ACTOR, 'item-towels', { nameEn: 'My towels' }),
      ).rejects.toMatchObject({ response: { code: 'CUSTOM_ITEM_ONLY' } });
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('edits content of the hotel’s own custom item', async () => {
      catalogView.findItemForHotel.mockResolvedValue(makeCustomItem());
      await service.updateItem(ACTOR, 'item-custom', {
        nameRu: 'Особая услуга',
        icon: 'bell',
      });
      const saved = itemsRepo.save.mock.calls[0][0];
      expect(saved.names.ru).toBe('Особая услуга');
      expect(saved.names.en).toBe('Special service');
      expect(saved.icon).toBe('bell');
    });

    it('custom items keep AR+EN mandatory', async () => {
      catalogView.findItemForHotel.mockResolvedValue(makeCustomItem());
      await expect(
        service.updateItem(ACTOR, 'item-custom', { nameEn: '' }),
      ).rejects.toMatchObject({
        response: { code: 'REQUEST_ITEM_NAMES_REQUIRED' },
      });
    });

    it('404 for cross-tenant/unknown items', async () => {
      catalogView.findItemForHotel.mockResolvedValue(null);
      await expect(
        service.updateItem(ACTOR, 'item-x', { enabled: false }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_ITEM_NOT_FOUND' } });
    });
  });

  describe('reorderItems (AC2)', () => {
    it('writes index-based sortOrder settings for the given order', async () => {
      await service.reorderItems(ACTOR, 'cat-1', {
        itemIds: ['item-custom', 'item-towels'],
      });
      expect(itemSettingsRepo.save).toHaveBeenCalledTimes(2);
      expect(itemSettingsRepo.save.mock.calls[0][0]).toMatchObject({
        itemId: 'item-custom',
        sortOrder: 0,
      });
      expect(itemSettingsRepo.save.mock.calls[1][0]).toMatchObject({
        itemId: 'item-towels',
        sortOrder: 1,
      });
    });

    it('rejects ids outside the category (or duplicates)', async () => {
      await expect(
        service.reorderItems(ACTOR, 'cat-1', {
          itemIds: ['item-towels', 'foreign-item'],
        }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_REORDER_INVALID' } });
      expect(itemSettingsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createCustomItem (AC3/AC4)', () => {
    const base = {
      categoryId: 'cat-1',
      nameEn: 'Pool towel',
      nameAr: 'منشفة مسبح',
      slaMinutes: 25,
    };

    it('creates a hotel-owned item with en fallback languages missing', async () => {
      catalogView.findItemForHotel.mockResolvedValue(makeCustomItem());
      await service.createCustomItem(ACTOR, base);
      const saved = itemsRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        hotelId: 'hotel-1',
        key: null,
        defaultSlaMinutes: 25,
        sortOrder: 3,
      });
      expect(saved.names).toEqual({ ar: 'منشفة مسبح', en: 'Pool towel' });
      expect(auditLogs.log).toHaveBeenCalled();
    });

    it('AC3 — quantity option demands a sane range', async () => {
      await expect(
        service.createCustomItem(ACTOR, {
          ...base,
          optionType: 'quantity',
          optionMin: 3,
          optionMax: 2,
        }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_OPTION_INVALID' } });
    });

    it('AC3 — time option carries no range', async () => {
      await expect(
        service.createCustomItem(ACTOR, {
          ...base,
          optionType: 'time',
          optionMax: 4,
        }),
      ).rejects.toMatchObject({ response: { code: 'REQUEST_OPTION_INVALID' } });
    });

    it('404 for an unknown category', async () => {
      categoriesRepo.findOne.mockResolvedValue(null);
      await expect(service.createCustomItem(ACTOR, base)).rejects.toMatchObject(
        { response: { code: 'REQUEST_CATEGORY_NOT_FOUND' } },
      );
    });
  });
});
