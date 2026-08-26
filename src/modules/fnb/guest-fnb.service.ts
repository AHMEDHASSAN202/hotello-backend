import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TranslationMap, localizeField } from '../requests/requests.constants';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { hotelLocalParts, naiveUtc, startOfHotelDay } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestLanguage, StayType } from '../tenant-stays/stays.constants';
import {
  CreateGuestFnbOrderDto,
  ListGuestFnbOrdersQueryDto,
} from './dto/guest-fnb-order.dto';
import { MenuAvailability, menuAvailability } from './fnb-availability';
import { FnbItem } from './fnb-item.entity';
import { FnbLocation } from './fnb-location.entity';
import { FnbMenuSection } from './fnb-menu-section.entity';
import { FnbMenu } from './fnb-menu.entity';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';
import { resolvePrice } from './fnb-pricing';
import {
  FnbPaymentMethod,
  FnbWindow,
  OPEN_FNB_ORDER_STATUSES,
} from './fnb.constants';
import { pickSnapshotNames } from './fnb-translations.util';

// ---------------------------------------------------------------------------
// Guest-facing view shapes (localized server-side — the app renders strings)
// ---------------------------------------------------------------------------

export interface GuestFnbVariantOptionView {
  key: string;
  name: string;
  included: boolean;
  unitPrice: number;
}

export interface GuestFnbItemView {
  id: string;
  name: string;
  description: string | null;
  photoThumbUrl: string | null;
  photoDetailUrl: string | null;
  included: boolean;
  /** Lowest applicable price ("from 80" for variants); 0 when included. */
  unitPrice: number;
  allowNotes: boolean;
  variant: {
    label: string;
    options: GuestFnbVariantOptionView[];
  } | null;
}

export interface GuestFnbSectionView {
  id: string;
  name: string;
  items: GuestFnbItemView[];
}

export interface GuestFnbMenuView {
  id: string;
  name: string;
  description: string | null;
  availability: MenuAvailability;
  windows: FnbWindow[];
  prepSlaMinutes: number;
  sections: GuestFnbSectionView[];
}

export interface GuestFnbLocationView {
  id: string;
  key: string;
  name: string;
  hasSpots: boolean;
  spotLabel: string | null;
}

export interface GuestFnbCatalogView {
  stayType: string;
  currency: string;
  paymentMethods: FnbPaymentMethod[];
  locations: GuestFnbLocationView[];
  menus: GuestFnbMenuView[];
}

export interface GuestFnbOrderLineView {
  id: string;
  itemName: string;
  variantOptionName: string | null;
  quantity: number;
  unitPrice: number;
  included: boolean;
  lineTotal: number;
  note: string | null;
  photoThumbUrl: string | null;
}

export interface GuestFnbOrderView {
  id: string;
  status: string;
  destinationType: string;
  locationName: string | null;
  spot: string | null;
  roomNumber: string;
  paymentMethod: string | null;
  totalAmount: number;
  currency: string;
  slaTargetMinutes: number;
  createdAt: Date;
  startedAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  /** Room-charge orders flip true once the front desk collects (16.8). */
  settled: boolean;
  updatedAt: Date;
  lines: GuestFnbOrderLineView[];
}

/**
 * Epic 16, Stories 16.5/16.6 — the guest side of F&B ordering.
 *
 * Identity = session (stay from the JWT); `?location`/`?spot` QR params are
 * client-side prefill only and never reach this service as identity. The
 * server recomputes ALL pricing with `resolvePrice` (spec note 3) — client
 * totals are display-only. Module/subscription gating happens here (the
 * guard no-ops on @GuestScope routes — recorded decision).
 */
@Injectable()
export class GuestFnbService {
  private readonly maxOpenPerStay: number;
  private readonly maxPerDay: number;

  constructor(
    @InjectRepository(FnbMenu)
    private readonly menusRepo: Repository<FnbMenu>,
    @InjectRepository(FnbMenuSection)
    private readonly sectionsRepo: Repository<FnbMenuSection>,
    @InjectRepository(FnbItem)
    private readonly itemsRepo: Repository<FnbItem>,
    @InjectRepository(FnbLocation)
    private readonly locationsRepo: Repository<FnbLocation>,
    @InjectRepository(FnbOrder)
    private readonly ordersRepo: Repository<FnbOrder>,
    @InjectRepository(FnbOrderLine)
    private readonly linesRepo: Repository<FnbOrderLine>,
    private readonly dataSource: DataSource,
    private readonly access: TenantAccessService,
    private readonly auditLogs: AuditLogsService,
    config: ConfigService,
  ) {
    this.maxOpenPerStay = parseInt(
      config.get('GUEST_FNB_MAX_OPEN_PER_STAY', '5'),
      10,
    );
    this.maxPerDay = parseInt(config.get('GUEST_FNB_MAX_PER_DAY', '20'), 10);
  }

  private async assertFnbAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('fnb')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'fnb',
      });
    }
  }

  // ------------------------------------------------------------------
  // Browse (16.5 AC1/AC2)
  // ------------------------------------------------------------------

  /**
   * One call boots the whole dining surface: menus (availability-annotated,
   * pricing resolved for THIS guest's stay type), delivery locations,
   * payment methods and currency.
   */
  async getMenus(stay: Stay): Promise<GuestFnbCatalogView> {
    await this.assertFnbAvailable(stay.hotelId);
    const hotelId = stay.hotelId;
    const [menus, sections, items, locations] = await Promise.all([
      this.menusRepo.find({ where: { hotelId, isActive: true } }),
      this.sectionsRepo.find({ where: { hotelId, isActive: true } }),
      this.itemsRepo.find({ where: { hotelId, isActive: true } }),
      this.locationsRepo.find({ where: { hotelId, isActive: true } }),
    ]);

    const minutes = hotelLocalParts(stay.hotel.timezone, new Date()).minutes;
    const stayType = stay.stayType as StayType;
    const language = stay.language;

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

    const bySort = (a: { sortOrder: number }, b: { sortOrder: number }) =>
      a.sortOrder - b.sortOrder;

    return {
      stayType: stay.stayType,
      currency: stay.hotel.currency,
      paymentMethods: stay.hotel.fnbRoomChargeEnabled
        ? ['cash', 'room_charge']
        : ['cash'],
      locations: locations.sort(bySort).map((l) => ({
        id: l.id,
        key: l.key,
        name: localizeField(l.names, language),
        hasSpots: l.hasSpots,
        spotLabel: l.spotLabel ? localizeField(l.spotLabel, language) : null,
      })),
      menus: menus
        .sort(bySort)
        .map((menu) => ({
          id: menu.id,
          name: localizeField(menu.names, language),
          description: menu.descriptions
            ? localizeField(menu.descriptions, language) || null
            : null,
          availability: menuAvailability(menu.windows, minutes),
          windows: menu.windows,
          prepSlaMinutes: menu.prepSlaMinutes,
          sections: (sectionsByMenu.get(menu.id) ?? [])
            .sort(bySort)
            .map((section) => ({
              id: section.id,
              name: localizeField(section.names, language),
              items: (itemsBySection.get(section.id) ?? [])
                .sort(bySort)
                .map((item) => this.toGuestItemView(item, menu, stayType, language)),
            }))
            .filter((section) => section.items.length > 0),
        }))
        .filter((menu) => menu.sections.length > 0),
    };
  }

  private toGuestItemView(
    item: FnbItem,
    menu: FnbMenu,
    stayType: StayType,
    language: GuestLanguage,
  ): GuestFnbItemView {
    const includedFor = item.includedFor ?? menu.defaultIncludedFor;
    const included = includedFor.includes(stayType);
    const variant = item.variant
      ? {
          label: localizeField(item.variant.label, language),
          options: item.variant.options.map((option) => ({
            key: option.key,
            name: localizeField(option.names, language),
            included,
            unitPrice: included ? 0 : option.price,
          })),
        }
      : null;
    const unitPrice = included
      ? 0
      : variant
        ? Math.min(...variant.options.map((o) => o.unitPrice))
        : item.price;
    return {
      id: item.id,
      name: localizeField(item.names, language),
      description: item.descriptions
        ? localizeField(item.descriptions, language) || null
        : null,
      photoThumbUrl: item.photoKeys ? `files/${item.photoKeys.thumb}` : null,
      photoDetailUrl: item.photoKeys ? `files/${item.photoKeys.detail}` : null,
      included,
      unitPrice,
      allowNotes: item.allowNotes,
      variant,
    };
  }

  // ------------------------------------------------------------------
  // Order (16.5 AC3–AC6, 16.4 AC2/AC3)
  // ------------------------------------------------------------------

  async createOrder(
    stay: Stay,
    dto: CreateGuestFnbOrderDto,
  ): Promise<GuestFnbOrderView> {
    await this.assertFnbAvailable(stay.hotelId);
    const now = new Date();
    await this.assertThrottles(stay, now);

    // Load + validate every referenced item, its section and menu.
    const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
    const items = await this.itemsRepo.find({
      where: { id: In(itemIds), hotelId: stay.hotelId },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    for (const id of itemIds) {
      if (!itemById.has(id)) {
        throw new NotFoundException({
          code: 'FNB_ITEM_NOT_FOUND',
          message: 'Menu item not found',
        });
      }
    }
    const sectionIds = [...new Set(items.map((i) => i.sectionId))];
    const menuIds = [...new Set(items.map((i) => i.menuId))];
    const [sections, menus] = await Promise.all([
      this.sectionsRepo.find({
        where: { id: In(sectionIds), hotelId: stay.hotelId },
      }),
      this.menusRepo.find({ where: { id: In(menuIds), hotelId: stay.hotelId } }),
    ]);
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const menuById = new Map(menus.map((m) => [m.id, m]));
    for (const item of items) {
      const section = sectionById.get(item.sectionId);
      const menu = menuById.get(item.menuId);
      if (!item.isActive || !section?.isActive || !menu?.isActive) {
        throw new ConflictException({
          code: 'FNB_ITEM_DISABLED',
          message: 'This item is not available right now',
        });
      }
    }

    // Server is the availability authority (spec note 2): every involved
    // menu must be open at POST time.
    const minutes = hotelLocalParts(stay.hotel.timezone, now).minutes;
    for (const menu of menuById.values()) {
      if (!menuAvailability(menu.windows, minutes).available) {
        throw new ConflictException({
          code: 'MENU_UNAVAILABLE',
          message: 'This menu is closed right now',
          menuId: menu.id,
        });
      }
    }

    // Pricing — resolved per line by THE function; totals are recomputed.
    const stayType = stay.stayType as StayType;
    const language = stay.language;
    const lines = dto.lines.map((line, index) => {
      const item = itemById.get(line.itemId)!;
      const menu = menuById.get(item.menuId)!;
      if (line.note?.trim() && !item.allowNotes) {
        throw new BadRequestException({
          code: 'FNB_NOTE_NOT_ALLOWED',
          message: 'Notes are disabled for this item',
        });
      }
      const { included, unitPrice } = resolvePrice(
        item,
        menu.defaultIncludedFor,
        line.variantKey ?? null,
        stayType,
      );
      const option = item.variant?.options.find(
        (o) => o.key === line.variantKey,
      );
      return {
        item,
        variantKey: option?.key ?? null,
        variantLabel: option && item.variant ? item.variant.label : null,
        variantOptionNames: option?.names ?? null,
        quantity: line.quantity,
        unitPrice,
        included,
        lineTotal: Math.round(unitPrice * line.quantity * 100) / 100,
        note: line.note?.trim() || null,
        sortOrder: index,
      };
    });
    const totalAmount =
      Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

    // Destination (16.5 AC4): room from the stay, or an active location.
    let location: FnbLocation | null = null;
    if (dto.destination.type === 'location') {
      location = await this.locationsRepo.findOne({
        where: {
          id: dto.destination.locationId,
          hotelId: stay.hotelId,
          isActive: true,
        },
      });
      if (!location) {
        throw new BadRequestException({
          code: 'FNB_LOCATION_INVALID',
          message: 'Choose a valid delivery location',
        });
      }
    }
    const spot =
      location && location.hasSpots && dto.destination.spot?.trim()
        ? dto.destination.spot.trim()
        : null;

    // Payment (16.4 AC2/AC3): fully-included orders skip the choice; a paid
    // total needs an enabled method.
    let paymentMethod: FnbPaymentMethod | null = null;
    if (totalAmount > 0) {
      const enabled: FnbPaymentMethod[] = stay.hotel.fnbRoomChargeEnabled
        ? ['cash', 'room_charge']
        : ['cash'];
      if (!dto.paymentMethod || !enabled.includes(dto.paymentMethod)) {
        throw new BadRequestException({
          code: 'FNB_PAYMENT_METHOD_INVALID',
          message: 'Choose how you would like to pay',
        });
      }
      paymentMethod = dto.paymentMethod;
    }

    const slaTargetMinutes = Math.max(
      ...[...menuById.values()].map((m) => m.prepSlaMinutes),
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(FnbOrder).save(
        manager.getRepository(FnbOrder).create({
          hotelId: stay.hotelId,
          stayId: stay.id,
          roomId: stay.roomId,
          roomNumber: stay.room.roomNumber,
          guestName: stay.guestName,
          guestLanguage: language,
          stayType: stay.stayType,
          menuIds: [...menuById.keys()],
          destinationType: dto.destination.type,
          locationId: location?.id ?? null,
          locationKey: location?.key ?? null,
          locationNames: location ? { ...location.names } : null,
          spot,
          paymentMethod,
          totalAmount,
          currency: stay.hotel.currency,
          status: 'new',
          slaTargetMinutes,
          dueAt: new Date(now.getTime() + slaTargetMinutes * 60_000),
          assignedToId: null,
        }),
      );
      const lineRows = await manager.getRepository(FnbOrderLine).save(
        lines.map((l) =>
          manager.getRepository(FnbOrderLine).create({
            orderId: order.id,
            hotelId: stay.hotelId,
            itemId: l.item.id,
            itemNames: pickSnapshotNames(l.item.names, language),
            variantKey: l.variantKey,
            variantLabel: l.variantLabel
              ? pickSnapshotNames(l.variantLabel, language)
              : null,
            variantOptionNames: l.variantOptionNames
              ? pickSnapshotNames(l.variantOptionNames, language)
              : null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            included: l.included,
            lineTotal: l.lineTotal,
            note: l.note,
            photoThumbKey: l.item.photoKeys?.thumb ?? null,
            sortOrder: l.sortOrder,
          }),
        ),
      );
      return { order, lineRows };
    });

    await this.auditLogs.log({
      action: 'fnb_order.created',
      entityType: 'fnb_order',
      entityId: saved.order.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        totalAmount,
        paymentMethod,
        destinationType: dto.destination.type,
      },
    });
    return this.toView(saved.order, saved.lineRows, language);
  }

  private async assertThrottles(stay: Stay, now: Date): Promise<void> {
    const openCount = await this.ordersRepo.count({
      where: { stayId: stay.id, status: In(OPEN_FNB_ORDER_STATUSES) },
    });
    if (openCount >= this.maxOpenPerStay) {
      throw new HttpException(
        {
          code: 'FNB_LIMIT_OPEN',
          message: 'Too many open orders for this stay',
          limit: this.maxOpenPerStay,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const dayCount = await this.ordersRepo.count({
      where: {
        stayId: stay.id,
        createdAt: MoreThanOrEqual(naiveUtc(startOfHotelDay(stay.hotel.timezone, now))),
      },
    });
    if (dayCount >= this.maxPerDay) {
      throw new HttpException(
        {
          code: 'FNB_LIMIT_DAILY',
          message: 'Daily order limit reached for this stay',
          limit: this.maxPerDay,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ------------------------------------------------------------------
  // Track & history (16.6)
  // ------------------------------------------------------------------

  /** Own stay only; `updatedSince` returns deltas (Epic 15 contract). */
  async listForStay(
    stay: Stay,
    query: ListGuestFnbOrdersQueryDto,
  ): Promise<{ data: GuestFnbOrderView[]; serverTime: string }> {
    await this.assertFnbAvailable(stay.hotelId);
    const where = query.updatedSince
      ? { stayId: stay.id, updatedAt: MoreThan(naiveUtc(query.updatedSince)) }
      : { stayId: stay.id };
    const orders = await this.ordersRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const lines = orders.length
      ? await this.linesRepo.find({
          where: { orderId: In(orders.map((o) => o.id)) },
        })
      : [];
    const linesByOrder = new Map<string, FnbOrderLine[]>();
    for (const line of lines) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push(line);
      linesByOrder.set(line.orderId, list);
    }
    return {
      data: orders.map((o) =>
        this.toView(o, linesByOrder.get(o.id) ?? [], stay.language),
      ),
      serverTime: new Date().toISOString(),
    };
  }

  /** 16.6 AC2 — guest cancel while `new` only. */
  async cancelOwn(stay: Stay, id: string): Promise<GuestFnbOrderView> {
    const order = await this.ordersRepo.findOne({
      where: { id, stayId: stay.id },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'FNB_ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    if (order.status !== 'new') {
      throw new ConflictException({
        code: 'FNB_ORDER_INVALID_STATUS',
        message: 'This order can no longer be cancelled',
        status: order.status,
      });
    }
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancelledById = null;
    order.cancelledReason = 'guest';
    const saved = await this.ordersRepo.save(order);
    await this.auditLogs.log({
      action: 'fnb_order.cancelled',
      entityType: 'fnb_order',
      entityId: saved.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        reason: 'guest',
      },
    });
    const lines = await this.linesRepo.find({ where: { orderId: saved.id } });
    return this.toView(saved, lines, stay.language);
  }

  private toView(
    order: FnbOrder,
    lines: FnbOrderLine[],
    language: GuestLanguage,
  ): GuestFnbOrderView {
    return {
      id: order.id,
      status: order.status,
      destinationType: order.destinationType,
      locationName: order.locationNames
        ? localizeField(order.locationNames, language)
        : null,
      spot: order.spot,
      roomNumber: order.roomNumber,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      currency: order.currency,
      slaTargetMinutes: order.slaTargetMinutes,
      createdAt: order.createdAt,
      startedAt: order.startedAt,
      outForDeliveryAt: order.outForDeliveryAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      cancelledReason: order.cancelledReason,
      settled: order.settledAt !== null,
      updatedAt: order.updatedAt,
      lines: [...lines]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({
          id: line.id,
          itemName: localizeField(line.itemNames, language),
          variantOptionName: line.variantOptionNames
            ? localizeField(line.variantOptionNames, language)
            : null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          included: line.included,
          lineTotal: line.lineTotal,
          note: line.note,
          photoThumbUrl: line.photoThumbKey
            ? `files/${line.photoThumbKey}`
            : null,
        })),
    };
  }
}
