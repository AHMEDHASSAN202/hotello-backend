import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TranslationMap } from '../requests/requests.constants';
import { StayType } from '../tenant-stays/stays.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateFnbItemDto, FnbVariantDto, UpdateFnbItemDto } from './dto/fnb-item.dto';
import { CreateFnbMenuDto, UpdateFnbMenuDto } from './dto/fnb-menu.dto';
import { CreateFnbSectionDto, UpdateFnbSectionDto } from './dto/fnb-section.dto';
import { FnbItem } from './fnb-item.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { FnbPhotoKeys, FnbVariant, FnbWindow } from './fnb.constants';
import {
  mergeDescriptions,
  mergeNames,
  slugify,
  touchesDescriptions,
  touchesNames,
} from './fnb-translations.util';

/** Management tree — full translation maps (the builder edits all 7). */
export interface FnbItemManageView {
  id: string;
  sectionId: string;
  names: TranslationMap;
  descriptions: TranslationMap | null;
  photoThumbUrl: string | null;
  photoDetailUrl: string | null;
  price: number;
  includedFor: StayType[] | null;
  variant: FnbVariant | null;
  allowNotes: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface FnbSectionManageView {
  id: string;
  menuId: string;
  names: TranslationMap;
  isActive: boolean;
  sortOrder: number;
  items: FnbItemManageView[];
}

export interface FnbMenuManageView {
  id: string;
  names: TranslationMap;
  descriptions: TranslationMap | null;
  windows: FnbWindow[];
  defaultIncludedFor: StayType[];
  prepSlaMinutes: number;
  isActive: boolean;
  sortOrder: number;
  sections: FnbSectionManageView[];
}

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }): number =>
  a.sortOrder - b.sortOrder;

/**
 * Epic 16, Story 16.2 — menu building. Everything soft-deactivates; orders
 * hold snapshots, so nothing here ever touches order rows (AC6). All lookups
 * filter hotelId → cross-tenant is a 404 (repo law).
 */
@Injectable()
export class TenantFnbMenusService {
  constructor(
    @InjectRepository(FnbMenu)
    private readonly menusRepo: Repository<FnbMenu>,
    @InjectRepository(FnbMenuSection)
    private readonly sectionsRepo: Repository<FnbMenuSection>,
    @InjectRepository(FnbItem)
    private readonly itemsRepo: Repository<FnbItem>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Full tree incl. inactive rows — the builder shows everything. */
  async getTree(user: TenantUser): Promise<{ menus: FnbMenuManageView[] }> {
    const [menus, sections, items] = await Promise.all([
      this.menusRepo.find({ where: { hotelId: user.hotelId } }),
      this.sectionsRepo.find({ where: { hotelId: user.hotelId } }),
      this.itemsRepo.find({ where: { hotelId: user.hotelId } }),
    ]);
    const itemsBySection = new Map<string, FnbItem[]>();
    for (const item of items) {
      const list = itemsBySection.get(item.sectionId) ?? [];
      list.push(item);
      itemsBySection.set(item.sectionId, list);
    }
    const sectionsByMenu = new Map<string, FnbMenuSection[]>();
    for (const section of sections) {
      const list = sectionsByMenu.get(section.menuId) ?? [];
      list.push(section);
      sectionsByMenu.set(section.menuId, list);
    }
    return {
      menus: menus.sort(bySort).map((menu) => ({
        id: menu.id,
        names: menu.names,
        descriptions: menu.descriptions,
        windows: menu.windows,
        defaultIncludedFor: menu.defaultIncludedFor,
        prepSlaMinutes: menu.prepSlaMinutes,
        isActive: menu.isActive,
        sortOrder: menu.sortOrder,
        sections: (sectionsByMenu.get(menu.id) ?? [])
          .sort(bySort)
          .map((section) => ({
            id: section.id,
            menuId: section.menuId,
            names: section.names,
            isActive: section.isActive,
            sortOrder: section.sortOrder,
            items: (itemsBySection.get(section.id) ?? [])
              .sort(bySort)
              .map((item) => this.toItemView(item)),
          })),
      })),
    };
  }

  // ------------------------------------------------------------------
  // Menus
  // ------------------------------------------------------------------

  async createMenu(
    user: TenantUser,
    dto: CreateFnbMenuDto,
  ): Promise<FnbMenuManageView> {
    const menu = await this.menusRepo.save(
      this.menusRepo.create({
        hotelId: user.hotelId,
        names: mergeNames(dto),
        descriptions: mergeDescriptions(dto),
        windows: dto.windows ?? [],
        defaultIncludedFor: dto.defaultIncludedFor ?? [],
        prepSlaMinutes: dto.prepSlaMinutes ?? 30,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? (await this.nextMenuSort(user.hotelId)),
      }),
    );
    await this.audit(user, 'fnb_menu.created', 'fnb_menu', menu.id, {
      created: { from: null, to: { nameEn: menu.names.en } },
    });
    return this.menuView(menu);
  }

  async updateMenu(
    user: TenantUser,
    id: string,
    dto: UpdateFnbMenuDto,
  ): Promise<FnbMenuManageView> {
    const menu = await this.findMenu(user.hotelId, id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (touchesNames(dto)) {
      const next = mergeNames(dto, menu.names);
      diff.names = { from: menu.names, to: next };
      menu.names = next;
    }
    if (touchesDescriptions(dto)) {
      const next = mergeDescriptions(dto, menu.descriptions);
      diff.descriptions = { from: menu.descriptions, to: next };
      menu.descriptions = next;
    }
    const applyField = <
      K extends 'windows' | 'defaultIncludedFor' | 'prepSlaMinutes' | 'isActive' | 'sortOrder',
    >(
      field: K,
      next: FnbMenu[K] | undefined,
    ) => {
      if (next === undefined) return;
      if (JSON.stringify(next) === JSON.stringify(menu[field])) return;
      diff[field] = { from: menu[field], to: next };
      menu[field] = next;
    };
    applyField('windows', dto.windows);
    applyField('defaultIncludedFor', dto.defaultIncludedFor);
    applyField('prepSlaMinutes', dto.prepSlaMinutes);
    applyField('isActive', dto.isActive);
    applyField('sortOrder', dto.sortOrder);

    if (Object.keys(diff).length > 0) {
      await this.menusRepo.save(menu);
      await this.audit(user, 'fnb_menu.updated', 'fnb_menu', menu.id, diff);
    }
    return this.menuView(menu);
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  async createSection(
    user: TenantUser,
    menuId: string,
    dto: CreateFnbSectionDto,
  ): Promise<FnbSectionManageView> {
    const menu = await this.findMenu(user.hotelId, menuId);
    const section = await this.sectionsRepo.save(
      this.sectionsRepo.create({
        hotelId: user.hotelId,
        menuId: menu.id,
        names: mergeNames(dto),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
    await this.audit(user, 'fnb_menu.updated', 'fnb_section', section.id, {
      created: { from: null, to: { nameEn: section.names.en, menuId } },
    });
    return { ...this.sectionBase(section), items: [] };
  }

  async updateSection(
    user: TenantUser,
    id: string,
    dto: UpdateFnbSectionDto,
  ): Promise<FnbSectionManageView> {
    const section = await this.findSection(user.hotelId, id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (touchesNames(dto)) {
      const next = mergeNames(dto, section.names);
      diff.names = { from: section.names, to: next };
      section.names = next;
    }
    if (dto.isActive !== undefined && dto.isActive !== section.isActive) {
      diff.isActive = { from: section.isActive, to: dto.isActive };
      section.isActive = dto.isActive;
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== section.sortOrder) {
      diff.sortOrder = { from: section.sortOrder, to: dto.sortOrder };
      section.sortOrder = dto.sortOrder;
    }

    if (Object.keys(diff).length > 0) {
      await this.sectionsRepo.save(section);
      await this.audit(user, 'fnb_menu.updated', 'fnb_section', section.id, diff);
    }
    const items = await this.itemsRepo.find({
      where: { sectionId: section.id },
    });
    return {
      ...this.sectionBase(section),
      items: items.sort(bySort).map((i) => this.toItemView(i)),
    };
  }

  // ------------------------------------------------------------------
  // Items
  // ------------------------------------------------------------------

  async createItem(
    user: TenantUser,
    sectionId: string,
    dto: CreateFnbItemDto,
  ): Promise<FnbItemManageView> {
    const section = await this.findSection(user.hotelId, sectionId);
    const item = await this.itemsRepo.save(
      this.itemsRepo.create({
        hotelId: user.hotelId,
        menuId: section.menuId,
        sectionId: section.id,
        names: mergeNames(dto),
        descriptions: mergeDescriptions(dto),
        photoKeys: null,
        price: dto.price,
        includedFor: dto.includedFor ?? null,
        variant: dto.variant ? this.buildVariant(dto.variant) : null,
        allowNotes: dto.allowNotes ?? true,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
    await this.audit(user, 'fnb_menu.updated', 'fnb_item', item.id, {
      created: { from: null, to: { nameEn: item.names.en, sectionId } },
    });
    return this.toItemView(item);
  }

  async updateItem(
    user: TenantUser,
    id: string,
    dto: UpdateFnbItemDto,
  ): Promise<FnbItemManageView> {
    const item = await this.findItem(user.hotelId, id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (touchesNames(dto)) {
      const next = mergeNames(dto, item.names);
      diff.names = { from: item.names, to: next };
      item.names = next;
    }
    if (touchesDescriptions(dto)) {
      const next = mergeDescriptions(dto, item.descriptions);
      diff.descriptions = { from: item.descriptions, to: next };
      item.descriptions = next;
    }
    if (dto.price !== undefined && dto.price !== item.price) {
      diff.price = { from: item.price, to: dto.price };
      item.price = dto.price;
    }
    if (dto.includedFor !== undefined) {
      const next = dto.includedFor;
      if (JSON.stringify(next) !== JSON.stringify(item.includedFor)) {
        diff.includedFor = { from: item.includedFor, to: next };
        item.includedFor = next;
      }
    }
    if (dto.variant !== undefined) {
      const next = dto.variant ? this.buildVariant(dto.variant) : null;
      if (JSON.stringify(next) !== JSON.stringify(item.variant)) {
        diff.variant = { from: item.variant, to: next };
        item.variant = next;
      }
    }
    if (dto.allowNotes !== undefined && dto.allowNotes !== item.allowNotes) {
      diff.allowNotes = { from: item.allowNotes, to: dto.allowNotes };
      item.allowNotes = dto.allowNotes;
    }
    if (dto.isActive !== undefined && dto.isActive !== item.isActive) {
      diff.isActive = { from: item.isActive, to: dto.isActive };
      item.isActive = dto.isActive;
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== item.sortOrder) {
      diff.sortOrder = { from: item.sortOrder, to: dto.sortOrder };
      item.sortOrder = dto.sortOrder;
    }

    if (Object.keys(diff).length > 0) {
      await this.itemsRepo.save(item);
      await this.audit(user, 'fnb_menu.updated', 'fnb_item', item.id, diff);
    }
    return this.toItemView(item);
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

  async findMenu(hotelId: string, id: string): Promise<FnbMenu> {
    const menu = await this.menusRepo.findOne({ where: { id, hotelId } });
    if (!menu) {
      throw new NotFoundException({
        code: 'FNB_MENU_NOT_FOUND',
        message: 'Menu not found',
      });
    }
    return menu;
  }

  async findSection(hotelId: string, id: string): Promise<FnbMenuSection> {
    const section = await this.sectionsRepo.findOne({ where: { id, hotelId } });
    if (!section) {
      throw new NotFoundException({
        code: 'FNB_SECTION_NOT_FOUND',
        message: 'Section not found',
      });
    }
    return section;
  }

  async findItem(hotelId: string, id: string): Promise<FnbItem> {
    const item = await this.itemsRepo.findOne({ where: { id, hotelId } });
    if (!item) {
      throw new NotFoundException({
        code: 'FNB_ITEM_NOT_FOUND',
        message: 'Item not found',
      });
    }
    return item;
  }

  /**
   * Server-generated stable option keys: slug of the EN name, deduped with
   * numeric suffixes. Same names → same keys, so carts survive harmless
   * edits; renamed options invalidate stale cart lines by design.
   */
  private buildVariant(dto: FnbVariantDto): FnbVariant {
    const used = new Set<string>();
    return {
      label: mergeNames(dto),
      options: dto.options.map((option) => {
        const base = slugify(option.nameEn) || 'option';
        let key = base;
        for (let i = 2; used.has(key); i += 1) key = `${base}-${i}`;
        used.add(key);
        return {
          key,
          names: mergeNames(option),
          price: option.price,
        };
      }),
    };
  }

  private async nextMenuSort(hotelId: string): Promise<number> {
    const count = await this.menusRepo.count({ where: { hotelId } });
    return count;
  }

  private sectionBase(
    section: FnbMenuSection,
  ): Omit<FnbSectionManageView, 'items'> {
    return {
      id: section.id,
      menuId: section.menuId,
      names: section.names,
      isActive: section.isActive,
      sortOrder: section.sortOrder,
    };
  }

  toItemView(item: FnbItem): FnbItemManageView {
    return {
      id: item.id,
      sectionId: item.sectionId,
      names: item.names,
      descriptions: item.descriptions,
      photoThumbUrl: item.photoKeys ? `files/${item.photoKeys.thumb}` : null,
      photoDetailUrl: item.photoKeys ? `files/${item.photoKeys.detail}` : null,
      price: item.price,
      includedFor: item.includedFor,
      variant: item.variant,
      allowNotes: item.allowNotes,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    };
  }

  private menuView(menu: FnbMenu): FnbMenuManageView {
    return {
      id: menu.id,
      names: menu.names,
      descriptions: menu.descriptions,
      windows: menu.windows,
      defaultIncludedFor: menu.defaultIncludedFor,
      prepSlaMinutes: menu.prepSlaMinutes,
      isActive: menu.isActive,
      sortOrder: menu.sortOrder,
      sections: [],
    };
  }

  /** 16.2 AC6 — fnb_menu.* audits with diffs. */
  private async audit(
    user: TenantUser,
    action: string,
    entityType: string,
    entityId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType,
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
