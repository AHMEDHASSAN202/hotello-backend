import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';

const CATEGORIES = [
  { id: 'cat-1', key: 'housekeeping', names: { en: 'Housekeeping' }, icon: 'sparkles', sortOrder: 0 },
  { id: 'cat-2', key: 'maintenance', names: { en: 'Maintenance' }, icon: 'wrench', sortOrder: 1 },
];
const ITEMS = [
  { id: 'i-1', categoryId: 'cat-1', hotelId: null, names: { en: 'Cleaning' }, icon: 'sparkles', sortOrder: 0, defaultSlaMinutes: 45, isActive: true },
  { id: 'i-2', categoryId: 'cat-1', hotelId: null, names: { en: 'Towels' }, icon: 'layers', sortOrder: 1, defaultSlaMinutes: 20, isActive: true },
  { id: 'i-3', categoryId: 'cat-1', hotelId: 'hotel-1', names: { en: 'Custom' }, icon: 'star', sortOrder: 2, defaultSlaMinutes: 30, isActive: true },
  { id: 'i-4', categoryId: 'cat-2', hotelId: null, names: { en: 'AC' }, icon: 'thermometer', sortOrder: 0, defaultSlaMinutes: 40, isActive: false },
];

describe('RequestCatalogViewService (15.1 AC2 — lazy per-hotel overlay)', () => {
  let service: RequestCatalogViewService;
  let categorySettings: Array<Record<string, unknown>>;
  let itemSettings: Array<Record<string, unknown>>;

  beforeEach(async () => {
    categorySettings = [];
    itemSettings = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestCatalogViewService,
        {
          provide: getRepositoryToken(RequestCategory),
          useValue: { find: jest.fn(async () => CATEGORIES) },
        },
        {
          provide: getRepositoryToken(RequestItem),
          useValue: { find: jest.fn(async () => ITEMS) },
        },
        {
          provide: getRepositoryToken(HotelRequestCategorySetting),
          useValue: { find: jest.fn(async () => categorySettings) },
        },
        {
          provide: getRepositoryToken(HotelRequestItemSetting),
          useValue: { find: jest.fn(async () => itemSettings) },
        },
      ],
    }).compile();
    service = moduleRef.get(RequestCatalogViewService);
  });

  it('zero settings rows → everything enabled with platform defaults', async () => {
    const catalog = await service.getEffectiveCatalog('hotel-1');
    expect(catalog).toHaveLength(2);
    expect(catalog[0].enabled).toBe(true);
    expect(catalog[0].items.map((e) => e.item.id)).toEqual(['i-1', 'i-2', 'i-3']);
    expect(catalog[0].items[1].slaMinutes).toBe(20);
    // inactive item is dropped
    expect(catalog[1].items).toHaveLength(0);
  });

  it('overlays enabled/sortOrder/slaMinutes from settings rows', async () => {
    categorySettings.push({ categoryId: 'cat-2', enabled: false });
    itemSettings.push(
      { itemId: 'i-1', enabled: false, sortOrder: null, slaMinutes: null },
      { itemId: 'i-2', enabled: null, sortOrder: 5, slaMinutes: 35 },
    );
    const catalog = await service.getEffectiveCatalog('hotel-1');
    expect(catalog[1].enabled).toBe(false);
    const hk = catalog[0].items;
    expect(hk.find((e) => e.item.id === 'i-1')?.enabled).toBe(false);
    const towels = hk.find((e) => e.item.id === 'i-2');
    expect(towels).toMatchObject({ enabled: true, sortOrder: 5, slaMinutes: 35 });
    // reorder pushed towels last
    expect(hk.map((e) => e.item.id)).toEqual(['i-1', 'i-3', 'i-2']);
  });

  it('findItemForHotel resolves effective state incl. category enablement', async () => {
    categorySettings.push({ categoryId: 'cat-1', enabled: false });
    const resolved = await service.findItemForHotel('hotel-1', 'i-2');
    expect(resolved).toMatchObject({
      enabled: true,
      categoryEnabled: false,
      slaMinutes: 20,
    });
    expect(await service.findItemForHotel('hotel-1', 'nope')).toBeNull();
  });
});
