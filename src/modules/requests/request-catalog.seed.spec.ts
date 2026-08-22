import { EntityManager } from 'typeorm';
import { DEFAULT_REQUEST_CATALOG } from './default-request-catalog';
import { seedRequestCatalog } from './request-catalog.seed';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import { GUEST_LANGUAGES } from '../tenant-stays/stays.constants';

const TOTAL_ITEMS = DEFAULT_REQUEST_CATALOG.reduce(
  (sum, c) => sum + c.items.length,
  0,
);

/** In-memory repo fakes keyed the way the seed looks rows up. */
function makeManager() {
  const categories: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const categoriesRepo = {
    findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
      return categories.find((c) => c.key === where.key) ?? null;
    }),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      if (!row.id) {
        row.id = `cat-${nextId++}`;
        categories.push(row);
      }
      return row;
    }),
  };
  const itemsRepo = {
    findOne: jest.fn(
      async ({
        where,
      }: {
        where: { categoryId: string; key: string };
      }) => {
        return (
          items.find(
            (i) =>
              i.categoryId === where.categoryId &&
              i.key === where.key &&
              i.hotelId === null,
          ) ?? null
        );
      },
    ),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      if (!row.id) {
        row.id = `item-${nextId++}`;
        items.push(row);
      }
      return row;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === RequestCategory ? categoriesRepo : itemsRepo,
    ),
  } as unknown as EntityManager;
  return { manager, categories, items, categoriesRepo, itemsRepo };
}

describe('seedRequestCatalog (15.1 AC1)', () => {
  it('seeds the four categories and all items as platform rows on first run', async () => {
    const { manager, categories, items } = makeManager();
    const result = await seedRequestCatalog(manager);

    expect(result.createdCategories).toBe(4);
    expect(result.createdItems).toBe(TOTAL_ITEMS);
    expect(categories.map((c) => c.key)).toEqual([
      'housekeeping',
      'maintenance',
      'amenities',
      'front_desk',
    ]);
    expect(items.every((i) => i.hotelId === null)).toBe(true);
    // the language-barrier core: wake-up call carries a time option, towels a quantity range
    const wakeUp = items.find((i) => i.key === 'wake_up_call');
    expect(wakeUp).toMatchObject({ optionType: 'time' });
    const towels = items.find((i) => i.key === 'extra_towels');
    expect(towels).toMatchObject({
      optionType: 'quantity',
      optionMin: 1,
      optionMax: 4,
    });
  });

  it('is idempotent — a second run creates and updates nothing', async () => {
    const { manager, categoriesRepo, itemsRepo } = makeManager();
    await seedRequestCatalog(manager);
    const savesAfterFirst =
      categoriesRepo.save.mock.calls.length + itemsRepo.save.mock.calls.length;

    const second = await seedRequestCatalog(manager);
    expect(second).toEqual({
      createdCategories: 0,
      updatedCategories: 0,
      createdItems: 0,
      updatedItems: 0,
    });
    expect(
      categoriesRepo.save.mock.calls.length + itemsRepo.save.mock.calls.length,
    ).toBe(savesAfterFirst);
  });

  it('re-propagates edited platform fields on the next run (translation fix path)', async () => {
    const { manager, items } = makeManager();
    await seedRequestCatalog(manager);
    const towels = items.find((i) => i.key === 'extra_towels') as {
      names: Record<string, string>;
    };
    towels.names = { ...towels.names, ru: 'опечатка' };

    const result = await seedRequestCatalog(manager);
    expect(result.updatedItems).toBe(1);
    expect(
      (items.find((i) => i.key === 'extra_towels') as unknown as RequestItem)
        .names.ru,
    ).toBe('Дополнительные полотенца');
  });

  it('never touches custom hotel items', async () => {
    const { manager, items, itemsRepo } = makeManager();
    await seedRequestCatalog(manager);
    const custom = {
      id: 'custom-1',
      categoryId: items[0].categoryId,
      hotelId: 'hotel-1',
      key: null,
      names: { ar: 'خدمة خاصة', en: 'Special service' },
    };
    items.push(custom);
    itemsRepo.save.mockClear();

    await seedRequestCatalog(manager);
    expect(itemsRepo.save).not.toHaveBeenCalled();
    expect(items.find((i) => i.id === 'custom-1')).toEqual(custom);
  });
});

describe('DEFAULT_REQUEST_CATALOG data invariants (15.1 AC1)', () => {
  it('every category and item is translated in all 7 guest languages', () => {
    for (const category of DEFAULT_REQUEST_CATALOG) {
      for (const lang of GUEST_LANGUAGES) {
        expect(category.names[lang]).toBeTruthy();
      }
      for (const item of category.items) {
        for (const lang of GUEST_LANGUAGES) {
          expect(item.names[lang]).toBeTruthy();
          expect(item.descriptions[lang]).toBeTruthy();
        }
      }
    }
  });

  it('every item has an icon and a positive SLA target', () => {
    for (const category of DEFAULT_REQUEST_CATALOG) {
      expect(category.icon).toBeTruthy();
      for (const item of category.items) {
        expect(item.icon).toBeTruthy();
        expect(item.defaultSlaMinutes).toBeGreaterThan(0);
      }
    }
  });

  it('quantity options carry a sane min/max range', () => {
    for (const item of DEFAULT_REQUEST_CATALOG.flatMap((c) => c.items)) {
      if (item.optionType === 'quantity') {
        expect(item.optionMin).toBeGreaterThanOrEqual(1);
        expect(item.optionMax).toBeGreaterThan(item.optionMin as number);
      }
      if (item.optionType === 'time') {
        expect(item.optionMin).toBeUndefined();
        expect(item.optionMax).toBeUndefined();
      }
    }
  });
});
