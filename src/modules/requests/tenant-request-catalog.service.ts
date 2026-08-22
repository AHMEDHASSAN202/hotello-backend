import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateCustomItemDto } from './dto/create-custom-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { HotelRequestCategorySetting } from './hotel-request-category-setting.entity';
import { HotelRequestItemSetting } from './hotel-request-item-setting.entity';
import {
  EffectiveItem,
  RequestCatalogViewService,
} from './request-catalog-view.service';
import { RequestCategory } from './request-category.entity';
import { RequestItem } from './request-item.entity';
import {
  RequestOptionType,
  TranslationMap,
} from './requests.constants';

/** Management view — full translation maps (the custom-item editor shows all 7). */
export interface CatalogItemManageView {
  id: string;
  key: string | null;
  names: TranslationMap;
  descriptions: TranslationMap | null;
  icon: string;
  optionType: string | null;
  optionMin: number | null;
  optionMax: number | null;
  defaultSlaMinutes: number;
  slaMinutes: number;
  sortOrder: number;
  enabled: boolean;
  isCustom: boolean;
}

export interface CatalogCategoryManageView {
  id: string;
  key: string;
  names: TranslationMap;
  icon: string;
  enabled: boolean;
  items: CatalogItemManageView[];
}

const NAME_KEYS = [
  ['nameAr', 'ar'],
  ['nameEn', 'en'],
  ['nameRu', 'ru'],
  ['nameFr', 'fr'],
  ['nameIt', 'it'],
  ['nameEs', 'es'],
  ['nameDe', 'de'],
] as const;
const DESCRIPTION_KEYS = [
  ['descriptionAr', 'ar'],
  ['descriptionEn', 'en'],
  ['descriptionRu', 'ru'],
  ['descriptionFr', 'fr'],
  ['descriptionIt', 'it'],
  ['descriptionEs', 'es'],
  ['descriptionDe', 'de'],
] as const;

/**
 * Epic 15, Story 15.1 — hotel-side catalog curation. Curation (enable /
 * reorder / SLA) writes per-hotel settings rows for ANY item; content edits
 * are custom-items-only — platform translations stay read-only so every
 * hotel's guests read the same professional copy (15.1 AC2).
 */
@Injectable()
export class TenantRequestCatalogService {
  constructor(
    @InjectRepository(RequestCategory)
    private readonly categoriesRepo: Repository<RequestCategory>,
    @InjectRepository(RequestItem)
    private readonly itemsRepo: Repository<RequestItem>,
    @InjectRepository(HotelRequestCategorySetting)
    private readonly categorySettingsRepo: Repository<HotelRequestCategorySetting>,
    @InjectRepository(HotelRequestItemSetting)
    private readonly itemSettingsRepo: Repository<HotelRequestItemSetting>,
    private readonly catalogView: RequestCatalogViewService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getCatalog(
    user: TenantUser,
  ): Promise<{ categories: CatalogCategoryManageView[] }> {
    const catalog = await this.catalogView.getEffectiveCatalog(user.hotelId);
    return {
      categories: catalog.map((c) => ({
        id: c.category.id,
        key: c.category.key,
        names: c.category.names,
        icon: c.category.icon,
        enabled: c.enabled,
        items: c.items.map((e) => this.toManageView(e)),
      })),
    };
  }

  /** 15.1 AC2 — category on/off (settings upsert; absence = enabled). */
  async setCategoryEnabled(
    user: TenantUser,
    categoryId: string,
    enabled: boolean,
  ): Promise<CatalogCategoryManageView> {
    const category = await this.categoriesRepo.findOne({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException({
        code: 'REQUEST_CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    let setting = await this.categorySettingsRepo.findOne({
      where: { hotelId: user.hotelId, categoryId },
    });
    const before = setting?.enabled ?? true;
    if (!setting) {
      setting = this.categorySettingsRepo.create({
        hotelId: user.hotelId,
        categoryId,
        enabled,
      });
    } else {
      setting.enabled = enabled;
    }
    await this.categorySettingsRepo.save(setting);
    await this.audit(user, 'category', categoryId, {
      enabled: { from: before, to: enabled },
    });
    const catalog = await this.getCatalog(user);
    return catalog.categories.find((c) => c.id === categoryId)!;
  }

  /**
   * 15.1 AC2/AC4 — enabled/slaMinutes curate any item; content fields only
   * the hotel's own custom items (403 CUSTOM_ITEM_ONLY otherwise).
   */
  async updateItem(
    user: TenantUser,
    itemId: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItemManageView> {
    const resolved = await this.findVisibleItem(user.hotelId, itemId);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    const contentTouched =
      NAME_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined) ||
      DESCRIPTION_KEYS.some(([dtoKey]) => dto[dtoKey] !== undefined) ||
      dto.icon !== undefined ||
      dto.optionType !== undefined ||
      dto.optionMin !== undefined ||
      dto.optionMax !== undefined;
    const isCustom = resolved.item.hotelId === user.hotelId;
    if (contentTouched && !isCustom) {
      throw new ForbiddenException({
        code: 'CUSTOM_ITEM_ONLY',
        message: 'Platform item content is read-only — curate or add a custom item instead',
      });
    }

    if (contentTouched) {
      const item = resolved.item;
      const names = { ...item.names };
      for (const [dtoKey, lang] of NAME_KEYS) {
        if (dto[dtoKey] !== undefined) names[lang] = dto[dtoKey];
      }
      const descriptions: TranslationMap = { ...(item.descriptions ?? {}) };
      for (const [dtoKey, lang] of DESCRIPTION_KEYS) {
        if (dto[dtoKey] !== undefined) descriptions[lang] = dto[dtoKey];
      }
      if (!names.ar || !names.en) {
        throw new BadRequestException({
          code: 'REQUEST_ITEM_NAMES_REQUIRED',
          message: 'Custom items require Arabic and English names',
        });
      }
      const optionType =
        dto.optionType !== undefined ? dto.optionType : item.optionType;
      const optionMin =
        dto.optionMin !== undefined ? dto.optionMin : item.optionMin;
      const optionMax =
        dto.optionMax !== undefined ? dto.optionMax : item.optionMax;
      this.validateOptionShape(optionType, optionMin, optionMax);
      diff.content = {
        from: {
          names: item.names,
          descriptions: item.descriptions,
          icon: item.icon,
          optionType: item.optionType,
          optionMin: item.optionMin,
          optionMax: item.optionMax,
        },
        to: {
          names,
          descriptions,
          icon: dto.icon ?? item.icon,
          optionType,
          optionMin,
          optionMax,
        },
      };
      item.names = names;
      item.descriptions = Object.keys(descriptions).length
        ? descriptions
        : null;
      if (dto.icon !== undefined) item.icon = dto.icon;
      item.optionType = (optionType ?? null) as RequestOptionType | null;
      item.optionMin = optionMin ?? null;
      item.optionMax = optionMax ?? null;
      await this.itemsRepo.save(item);
    }

    if (dto.enabled !== undefined || dto.slaMinutes !== undefined) {
      let setting = await this.itemSettingsRepo.findOne({
        where: { hotelId: user.hotelId, itemId },
      });
      if (dto.enabled !== undefined && dto.enabled !== resolved.enabled) {
        diff.enabled = { from: resolved.enabled, to: dto.enabled };
      }
      if (
        dto.slaMinutes !== undefined &&
        dto.slaMinutes !== resolved.slaMinutes
      ) {
        diff.slaMinutes = { from: resolved.slaMinutes, to: dto.slaMinutes };
      }
      if (!setting) {
        setting = this.itemSettingsRepo.create({
          hotelId: user.hotelId,
          itemId,
          enabled: null,
          sortOrder: null,
          slaMinutes: null,
        });
      }
      if (dto.enabled !== undefined) setting.enabled = dto.enabled;
      if (dto.slaMinutes !== undefined) setting.slaMinutes = dto.slaMinutes;
      await this.itemSettingsRepo.save(setting);
    }

    if (Object.keys(diff).length > 0) {
      await this.audit(user, 'item', itemId, diff);
    }
    const fresh = await this.findVisibleItem(user.hotelId, itemId);
    return this.toManageView(fresh);
  }

  /** 15.1 AC2 — reorder within a category; index = per-hotel sortOrder. */
  async reorderItems(
    user: TenantUser,
    categoryId: string,
    dto: ReorderItemsDto,
  ): Promise<CatalogItemManageView[]> {
    const catalog = await this.catalogView.getEffectiveCatalog(user.hotelId);
    const category = catalog.find((c) => c.category.id === categoryId);
    if (!category) {
      throw new NotFoundException({
        code: 'REQUEST_CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    const visibleIds = new Set(category.items.map((e) => e.item.id));
    const unknown = dto.itemIds.filter((id) => !visibleIds.has(id));
    if (unknown.length > 0 || new Set(dto.itemIds).size !== dto.itemIds.length) {
      throw new BadRequestException({
        code: 'REQUEST_REORDER_INVALID',
        message: 'Reorder must reference items of this category only, once each',
      });
    }
    for (const [index, itemId] of dto.itemIds.entries()) {
      let setting = await this.itemSettingsRepo.findOne({
        where: { hotelId: user.hotelId, itemId },
      });
      if (!setting) {
        setting = this.itemSettingsRepo.create({
          hotelId: user.hotelId,
          itemId,
          enabled: null,
          slaMinutes: null,
          sortOrder: index,
        });
      } else {
        setting.sortOrder = index;
      }
      await this.itemSettingsRepo.save(setting);
    }
    await this.audit(user, 'category', categoryId, {
      order: { from: [...visibleIds], to: dto.itemIds },
    });
    const fresh = await this.catalogView.getEffectiveCatalog(user.hotelId);
    return (
      fresh
        .find((c) => c.category.id === categoryId)
        ?.items.map((e) => this.toManageView(e)) ?? []
    );
  }

  /** 15.1 AC4 — create a custom item inside an existing category. */
  async createCustomItem(
    user: TenantUser,
    dto: CreateCustomItemDto,
  ): Promise<CatalogItemManageView> {
    const category = await this.categoriesRepo.findOne({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundException({
        code: 'REQUEST_CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    this.validateOptionShape(
      dto.optionType ?? null,
      dto.optionMin ?? null,
      dto.optionMax ?? null,
    );
    const names: TranslationMap = { ar: dto.nameAr, en: dto.nameEn };
    for (const [dtoKey, lang] of NAME_KEYS) {
      if (lang !== 'ar' && lang !== 'en' && dto[dtoKey]) {
        names[lang] = dto[dtoKey];
      }
    }
    const descriptions: TranslationMap = {};
    for (const [dtoKey, lang] of DESCRIPTION_KEYS) {
      if (dto[dtoKey]) descriptions[lang] = dto[dtoKey];
    }
    const catalog = await this.catalogView.getEffectiveCatalog(user.hotelId);
    const siblings =
      catalog.find((c) => c.category.id === dto.categoryId)?.items ?? [];
    const maxSort = siblings.reduce((max, e) => Math.max(max, e.sortOrder), -1);

    const saved = await this.itemsRepo.save(
      this.itemsRepo.create({
        categoryId: dto.categoryId,
        hotelId: user.hotelId,
        key: null,
        names,
        descriptions: Object.keys(descriptions).length ? descriptions : null,
        icon: dto.icon ?? category.icon,
        optionType: dto.optionType ?? null,
        optionMin: dto.optionMin ?? null,
        optionMax: dto.optionMax ?? null,
        defaultSlaMinutes: dto.slaMinutes,
        sortOrder: maxSort + 1,
        isActive: true,
      }),
    );
    await this.audit(user, 'item', saved.id, {
      created: { from: null, to: { nameEn: dto.nameEn, custom: true } },
    });
    const fresh = await this.findVisibleItem(user.hotelId, saved.id);
    return this.toManageView(fresh);
  }

  /** Visible = platform item or the hotel's own custom item; else 404. */
  private async findVisibleItem(
    hotelId: string,
    itemId: string,
  ): Promise<EffectiveItem & { categoryEnabled: boolean }> {
    const resolved = await this.catalogView.findItemForHotel(hotelId, itemId);
    if (!resolved) {
      throw new NotFoundException({
        code: 'REQUEST_ITEM_NOT_FOUND',
        message: 'Request item not found',
      });
    }
    return resolved;
  }

  /** 15.1 AC3 — quantity needs a sane range; time carries no range. */
  private validateOptionShape(
    optionType: string | null | undefined,
    optionMin: number | null | undefined,
    optionMax: number | null | undefined,
  ): void {
    const invalid =
      optionType === 'quantity'
        ? optionMin == null || optionMax == null || optionMax <= optionMin
        : optionMin != null || optionMax != null;
    if (invalid) {
      throw new BadRequestException({
        code: 'REQUEST_OPTION_INVALID',
        message: 'Invalid option configuration for this item',
      });
    }
  }

  private toManageView(
    e: EffectiveItem & { categoryEnabled?: boolean },
  ): CatalogItemManageView {
    return {
      id: e.item.id,
      key: e.item.key,
      names: e.item.names,
      descriptions: e.item.descriptions,
      icon: e.item.icon,
      optionType: e.item.optionType,
      optionMin: e.item.optionMin,
      optionMax: e.item.optionMax,
      defaultSlaMinutes: e.item.defaultSlaMinutes,
      slaMinutes: e.slaMinutes,
      sortOrder: e.sortOrder,
      enabled: e.enabled,
      isCustom: e.item.hotelId !== null,
    };
  }

  /** 15.1 AC6 — request_catalog.updated with field diffs. */
  private async audit(
    user: TenantUser,
    entity: 'category' | 'item',
    entityId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action: 'request_catalog.updated',
      entityType: `request_${entity}`,
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
