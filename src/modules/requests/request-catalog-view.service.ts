import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';

/**
 * Epic 15 — resolves a hotel's EFFECTIVE catalog: shared platform rows + the
 * hotel's custom items, overlaid with the hotel's settings rows. Absence of a
 * settings row (or a NULL column) means "platform default" — a new hotel
 * sees the full enabled catalog with zero rows (recorded spec-note-1 choice).
 *
 * One resolution path for both surfaces: the guest catalog filters to
 * enabled-only; the tenant management screen shows everything.
 */
export interface EffectiveItem {
  item: RequestItem;
  enabled: boolean;
  sortOrder: number;
  slaMinutes: number;
}

export interface EffectiveCategory {
  category: RequestCategory;
  enabled: boolean;
  items: EffectiveItem[];
}

@Injectable()
export class RequestCatalogViewService {
  constructor(
    @InjectRepository(RequestCategory)
    private readonly categoriesRepo: Repository<RequestCategory>,
    @InjectRepository(RequestItem)
    private readonly itemsRepo: Repository<RequestItem>,
    @InjectRepository(HotelRequestCategorySetting)
    private readonly categorySettingsRepo: Repository<HotelRequestCategorySetting>,
    @InjectRepository(HotelRequestItemSetting)
    private readonly itemSettingsRepo: Repository<HotelRequestItemSetting>,
  ) {}

  async getEffectiveCatalog(hotelId: string): Promise<EffectiveCategory[]> {
    const [categories, items, categorySettings, itemSettings] =
      await Promise.all([
        this.categoriesRepo.find({ order: { sortOrder: 'ASC' } }),
        this.itemsRepo.find({
          where: [{ hotelId: IsNull() }, { hotelId }],
          order: { sortOrder: 'ASC' },
        }),
        this.categorySettingsRepo.find({ where: { hotelId } }),
        this.itemSettingsRepo.find({ where: { hotelId } }),
      ]);
    const categorySettingFor = new Map(
      categorySettings.map((s) => [s.categoryId, s]),
    );
    const itemSettingFor = new Map(itemSettings.map((s) => [s.itemId, s]));

    return categories.map((category) => {
      const effectiveItems = items
        .filter((item) => item.categoryId === category.id && item.isActive)
        .map((item) => {
          const setting = itemSettingFor.get(item.id);
          return {
            item,
            enabled: setting?.enabled ?? true,
            sortOrder: setting?.sortOrder ?? item.sortOrder,
            slaMinutes: setting?.slaMinutes ?? item.defaultSlaMinutes,
          };
        })
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.item.sortOrder - b.item.sortOrder,
        );
      return {
        category,
        enabled: categorySettingFor.get(category.id)?.enabled ?? true,
        items: effectiveItems,
      };
    });
  }

  /**
   * Resolve one item as the guest submit path sees it. Returns null when the
   * item doesn't exist for this hotel (cross-tenant custom ids included —
   * caller 404s, never confirming other tenants' items).
   */
  async findItemForHotel(
    hotelId: string,
    itemId: string,
  ): Promise<(EffectiveItem & { categoryEnabled: boolean }) | null> {
    const catalog = await this.getEffectiveCatalog(hotelId);
    for (const category of catalog) {
      const match = category.items.find((e) => e.item.id === itemId);
      if (match) return { ...match, categoryEnabled: category.enabled };
    }
    return null;
  }
}
