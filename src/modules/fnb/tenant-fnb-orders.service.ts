import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  applyLaneFilter,
  Lane,
  LaneTombstoneReason,
  requestedLanes,
} from '../../common/lanes';
import { Hotel } from '../hotels/hotel.entity';
import { PushService } from '../push/push.service';
import { localizeField, TranslationMap } from '../requests/requests.constants';
import { WILDCARD } from '../roles/permissions.constants';
import { naiveUtc, startOfHotelDay } from '../tenant-stays/stay-time';
import { TenantStaysService } from '../tenant-stays/tenant-stays.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  AssignFnbOrderDto,
  CancelFnbOrderDto,
  ListTenantFnbOrdersQueryDto,
  SettleFnbOrdersDto,
} from './dto/tenant-fnb-orders.dto';
import { FnbSettlementSource } from './fnb-settlement-source';
import { FnbOrderLine } from './fnb-order-line.entity';
import { FnbOrder } from './fnb-order.entity';
import {
  FINAL_FNB_ORDER_STATUSES,
  FNB_ORDER_TRANSITIONS,
  FnbOrderStatus,
  OPEN_FNB_ORDER_STATUSES,
} from './fnb.constants';

export interface FnbBoardCounts {
  open: number;
  deliveredToday: number;
  overdueNow: number;
  /** Delivered paid totals today — the number that sells the module (AC3). */
  revenueToday: number;
  /** 26.5 AC2 — only present when `assignee` was requested (Staff PWA). */
  myDoneToday?: number;
}

export interface TenantFnbOrderLineView {
  id: string;
  itemNameEn: string;
  itemNameAr: string;
  /** Guest-language name (falls back to EN) — cards show what the guest saw. */
  itemName: string;
  variantOptionNameEn: string | null;
  variantOptionNameAr: string | null;
  quantity: number;
  unitPrice: number;
  included: boolean;
  lineTotal: number;
  note: string | null;
}

export interface TenantFnbOrderView {
  id: string;
  roomNumber: string;
  guestName: string;
  guestLanguage: string;
  stayId: string;
  destinationType: string;
  locationId: string | null;
  locationNameEn: string | null;
  locationNameAr: string | null;
  spot: string | null;
  paymentMethod: string | null;
  totalAmount: number;
  currency: string;
  status: string;
  slaTargetMinutes: number;
  dueAt: Date;
  menuIds: string[];
  assignedTo: { id: string; name: string } | null;
  createdAt: Date;
  startedAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  cancelNote: string | null;
  settledAt: Date | null;
  updatedAt: Date;
  lines: TenantFnbOrderLineView[];
}

const localized = (map: TranslationMap | null, lang: 'en' | 'ar'): string =>
  map ? (map[lang] ?? map.en ?? '') : '';

/** 26.2 AC1 — lane rules for F&B orders, relative to the caller. */
function laneOfOrder(view: TenantFnbOrderView, userId: string): Lane | null {
  if (!OPEN_FNB_ORDER_STATUSES.includes(view.status as never)) return null;
  if (view.assignedTo?.id === userId) return 'mine';
  if (view.assignedTo === null) return 'available';
  return null;
}
function reasonOfOrder(view: TenantFnbOrderView): LaneTombstoneReason {
  if (view.status === 'cancelled') return 'cancelled';
  if (view.status === 'delivered') return 'closed';
  return 'taken';
}

/**
 * Epic 16, Stories 16.7/16.8 — the kitchen board + lifecycle + room-charge
 * settlement. Mirrors the requests board contracts (delta polling drops the
 * status filter so finalized rows flow out; counts in one shape; the
 * options-endpoint assignment pattern) with the F&B transition map enforced
 * server-side. Lines are batch-loaded, never joined into pagination
 * (recorded two-pass pagination ruling). Story 21.6 AC2 — the settlement
 * query/mutation itself now lives in `FnbSettlementSource`; this service
 * delegates to it and keeps its own audit entry + response shape so the
 * public routes stay byte-identical.
 */
@Injectable()
export class TenantFnbOrdersService {
  private readonly logger = new Logger(TenantFnbOrdersService.name);

  constructor(
    @InjectRepository(FnbOrder)
    private readonly ordersRepo: Repository<FnbOrder>,
    @InjectRepository(FnbOrderLine)
    private readonly linesRepo: Repository<FnbOrderLine>,
    @InjectRepository(TenantUser)
    private readonly usersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly stays: TenantStaysService,
    private readonly auditLogs: AuditLogsService,
    private readonly fnbSettlement: FnbSettlementSource,
    private readonly push: PushService,
  ) {}

  // ------------------------------------------------------------------
  // Board & history (16.7 AC1/AC3)
  // ------------------------------------------------------------------

  async list(user: TenantUser, query: ListTenantFnbOrdersQueryDto) {
    if (query.tab === 'history' && !query.updatedSince) {
      return this.listHistory(user, query);
    }
    return this.listBoard(user, query);
  }

  private async listBoard(
    user: TenantUser,
    query: ListTenantFnbOrdersQueryDto,
  ) {
    const now = new Date();
    // Delta mode drops the status filter so completed/cancelled rows reach
    // the client and clear off the board (requests parity).
    const where: Record<string, unknown> = query.updatedSince
      ? { hotelId: user.hotelId, updatedAt: MoreThan(naiveUtc(query.updatedSince)) }
      : { hotelId: user.hotelId, status: In(OPEN_FNB_ORDER_STATUSES) };
    if (!query.updatedSince) {
      if (query.status) where.status = query.status;
      if (query.assigneeId) where.assignedToId = query.assigneeId;
      if (query.overdue === '1') {
        where.status = query.status ?? In(OPEN_FNB_ORDER_STATUSES);
        where.dueAt = LessThan(now);
      }
      if (query.destination === 'room') where.destinationType = 'room';
      else if (query.destination) where.locationId = query.destination;
    }

    let orders = await this.ordersRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    if (!query.updatedSince && query.menuId) {
      orders = orders.filter((o) => o.menuIds.includes(query.menuId!));
    }
    const [views, counts] = await Promise.all([
      this.toViews(orders),
      this.counts(user.hotelId),
    ]);
    const data = query.assignee
      ? applyLaneFilter(
          views,
          requestedLanes(query.assignee),
          (v) => laneOfOrder(v, user.id),
          reasonOfOrder,
          query.updatedSince ? 'delta' : 'full',
        )
      : views;
    if (query.assignee) counts.myDoneToday = await this.myDoneToday(user);
    return { data, counts, serverTime: new Date().toISOString() };
  }

  /** 26.5 AC2 — my deliveries since the hotel-local day start. */
  private async myDoneToday(user: TenantUser): Promise<number> {
    const hotel = await this.hotelsRepo.findOne({
      where: { id: user.hotelId },
    });
    const dayStart = startOfHotelDay(
      hotel?.timezone ?? 'Africa/Cairo',
      new Date(),
    );
    return this.ordersRepo.count({
      where: {
        hotelId: user.hotelId,
        deliveredById: user.id,
        status: 'delivered',
        deliveredAt: MoreThan(dayStart),
      },
    });
  }

  private async listHistory(
    user: TenantUser,
    query: ListTenantFnbOrdersQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.ordersRepo
      .createQueryBuilder('o')
      .where('o.hotelId = :hotelId', { hotelId: user.hotelId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: query.status ? [query.status] : FINAL_FNB_ORDER_STATUSES,
      });
    if (query.menuId) {
      qb.andWhere(`o."menuIds" @> :menuJson::jsonb`, {
        menuJson: JSON.stringify([query.menuId]),
      });
    }
    if (query.assigneeId) {
      qb.andWhere('o.assignedToId = :assigneeId', {
        assigneeId: query.assigneeId,
      });
    }
    if (query.destination === 'room') {
      qb.andWhere(`o.destinationType = 'room'`);
    } else if (query.destination) {
      qb.andWhere('o.locationId = :locationId', {
        locationId: query.destination,
      });
    }
    const [orders, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { data: await this.toViews(orders), total, page, pageSize };
  }

  async counts(hotelId: string): Promise<FnbBoardCounts> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const dayStart = startOfHotelDay(
      hotel?.timezone ?? 'Africa/Cairo',
      new Date(),
    );
    const [open, deliveredToday, overdueNow, revenueRow] = await Promise.all([
      this.ordersRepo.count({
        where: { hotelId, status: In(OPEN_FNB_ORDER_STATUSES) },
      }),
      this.ordersRepo.count({
        where: { hotelId, status: 'delivered', deliveredAt: MoreThan(dayStart) },
      }),
      this.ordersRepo.count({
        where: {
          hotelId,
          status: In(OPEN_FNB_ORDER_STATUSES),
          dueAt: LessThan(new Date()),
        },
      }),
      this.ordersRepo
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.totalAmount), 0)', 'sum')
        .where('o.hotelId = :hotelId', { hotelId })
        .andWhere(`o.status = 'delivered'`)
        .andWhere('o.deliveredAt > :dayStart', { dayStart })
        .getRawOne<{ sum: string }>(),
    ]);
    return {
      open,
      deliveredToday,
      overdueNow,
      revenueToday: parseFloat(revenueRow?.sum ?? '0'),
    };
  }

  /** Options endpoint (AC2) — active staff whose role can work orders. */
  async listAssignees(user: TenantUser): Promise<
    Array<{ id: string; name: string; roleNameEn: string; roleNameAr: string }>
  > {
    const users = await this.usersRepo
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .where('u.hotelId = :hotelId', { hotelId: user.hotelId })
      .andWhere(`u.status = 'active'`)
      .andWhere(
        `(r.permissions @> ARRAY[:perm]::text[] OR r.permissions @> ARRAY[:wildcard]::text[])`,
        { perm: 'fnb_orders.update', wildcard: WILDCARD },
      )
      .orderBy('u.name', 'ASC')
      .getMany();
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      roleNameEn: u.role.nameEn,
      roleNameAr: u.role.nameAr,
    }));
  }

  async getDetail(user: TenantUser, id: string): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    return (await this.toViews([order]))[0];
  }

  // ------------------------------------------------------------------
  // Lifecycle (16.7 AC2/AC4)
  // ------------------------------------------------------------------

  async start(user: TenantUser, id: string): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    this.assertTransition(order, 'preparing');
    order.status = 'preparing';
    order.startedAt = new Date();
    order.startedById = user.id;
    // Starting an unowned ticket claims it (requests parity).
    if (!order.assignedToId) order.assignedToId = user.id;
    const saved = await this.ordersRepo.save(order);
    await this.audit('fnb_order.started', saved, user);
    await this.notifyOrderPushSafely(saved);
    return (await this.toViews([saved]))[0];
  }

  async outForDelivery(
    user: TenantUser,
    id: string,
  ): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    this.assertTransition(order, 'on_the_way');
    order.status = 'on_the_way';
    order.outForDeliveryAt = new Date();
    const saved = await this.ordersRepo.save(order);
    await this.audit('fnb_order.out_for_delivery', saved, user);
    await this.notifyOrderPushSafely(saved);
    return (await this.toViews([saved]))[0];
  }

  async deliver(user: TenantUser, id: string): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    this.assertTransition(order, 'delivered');
    order.status = 'delivered';
    order.deliveredAt = new Date();
    order.deliveredById = user.id;
    const saved = await this.ordersRepo.save(order);
    await this.audit('fnb_order.delivered', saved, user, {
      totalAmount: saved.totalAmount,
      paymentMethod: saved.paymentMethod,
    });
    await this.notifyOrderPushSafely(saved);
    return (await this.toViews([saved]))[0];
  }

  async cancel(
    user: TenantUser,
    id: string,
    dto: CancelFnbOrderDto,
  ): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    this.assertTransition(order, 'cancelled');
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancelledById = user.id;
    order.cancelledReason = dto.reason;
    order.cancelNote = dto.note?.trim() || null;
    const saved = await this.ordersRepo.save(order);
    await this.audit('fnb_order.cancelled', saved, user, {
      reason: dto.reason,
    });
    await this.notifyOrderPushSafely(saved);
    return (await this.toViews([saved]))[0];
  }

  async assign(
    user: TenantUser,
    id: string,
    dto: AssignFnbOrderDto,
  ): Promise<TenantFnbOrderView> {
    const order = await this.findOrder(user.hotelId, id);
    if (!OPEN_FNB_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException({
        code: 'FNB_ORDER_INVALID_STATUS',
        message: 'Finalized orders cannot be reassigned',
        status: order.status,
      });
    }
    let assignee: TenantUser | null = null;
    if (dto.assigneeId) {
      assignee = await this.usersRepo.findOne({
        where: { id: dto.assigneeId, hotelId: user.hotelId },
        relations: ['role'],
      });
      const grants =
        assignee &&
        assignee.status === 'active' &&
        (assignee.role.permissions.includes(WILDCARD) ||
          assignee.role.permissions.includes('fnb_orders.update'));
      if (!grants) {
        throw new UnprocessableEntityException({
          code: 'FNB_ASSIGNEE_INVALID',
          message: 'Assignee must be an active staff member who can work orders',
        });
      }
    }
    order.assignedToId = assignee?.id ?? null;
    const saved = await this.ordersRepo.save(order);
    await this.audit('fnb_order.assigned', saved, user, {
      assigneeId: assignee?.id ?? null,
    });
    if (assignee && assignee.id !== user.id) {
      await this.notifyStaffSafely(
        saved.hotelId,
        'staff_assigned',
        { tenantUserIds: [assignee.id] },
        {
          feed: 'orders',
          id: saved.id,
          roomNumber: saved.roomNumber,
          locationNames: saved.locationNames,
          spot: saved.spot,
        },
        saved.id,
      );
    }
    return (await this.toViews([saved]))[0];
  }

  // ------------------------------------------------------------------
  // Stay orders + settlement (16.8)
  // ------------------------------------------------------------------

  /**
   * The stay drawer's list + the "Unsettled room charges" line (AC1). The
   * unsettled total delegates to `FnbSettlementSource` — the single
   * implementation of fnb settlement eligibility, shared with
   * `StaySettlementService`'s combined checkout total (Story 21.6 AC2).
   */
  async stayOrders(
    user: TenantUser,
    stayId: string,
  ): Promise<{ data: TenantFnbOrderView[]; unsettledTotal: number }> {
    // Cross-tenant chokepoint: unknown/foreign stays 404 here.
    await this.stays.findStayInHotel(user.hotelId, stayId);
    const [orders, unsettled] = await Promise.all([
      this.ordersRepo.find({
        where: { hotelId: user.hotelId, stayId },
        order: { createdAt: 'DESC' },
      }),
      this.fnbSettlement.findUnsettled(user.hotelId, stayId),
    ]);
    return {
      data: await this.toViews(orders),
      unsettledTotal: this.roundedSum(unsettled),
    };
  }

  /**
   * AC2 — bulk "mark as settled" at checkout. Idempotent: only delivered
   * room-charge orders with no settledAt move; a second call settles zero.
   * Auto-checkout never calls this — unsettled charges stay visible. The
   * actual query/mutation lives in `FnbSettlementSource.markSettled` (this
   * route's optional `orderIds` subset is an fnb-only extra on top of it);
   * this method keeps this route's own audit entry + response shape.
   */
  async settleStayOrders(
    user: TenantUser,
    stayId: string,
    dto: SettleFnbOrdersDto,
  ): Promise<{ settled: number; unsettledTotal: number }> {
    await this.stays.findStayInHotel(user.hotelId, stayId);
    const settledLines = await this.fnbSettlement.markSettled(
      user.hotelId,
      stayId,
      user.id,
      dto.orderIds,
    );
    if (settledLines.length > 0) {
      await this.auditLogs.log({
        action: 'fnb_orders.settled',
        entityType: 'stay',
        entityId: stayId,
        actorId: user.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: user.hotelId,
          orderIds: settledLines.map((l) => l.id),
          total: settledLines.reduce((sum, l) => sum + l.totalAmount, 0),
        },
      });
    }
    const remaining = await this.fnbSettlement.findUnsettled(
      user.hotelId,
      stayId,
    );
    return {
      settled: settledLines.length,
      unsettledTotal: this.roundedSum(remaining),
    };
  }

  private roundedSum(lines: { totalAmount: number }[]): number {
    return (
      Math.round(lines.reduce((sum, l) => sum + l.totalAmount, 0) * 100) / 100
    );
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

  /**
   * 23.4 AC2 — one push per hooked transition (start/outForDelivery/deliver/
   * cancel only; `assign` is never a guest-visible status change, and
   * guest-initiated cancellation is `GuestFnbService.cancelOwn` — a
   * different service that never takes a `PushService` dependency, so it
   * structurally can't push: the guest already knows, they did it).
   * `itemCount` sums line quantities (a fresh, lightweight per-order lookup —
   * `start`/`outForDelivery`/`deliver`/`cancel` don't otherwise load lines).
   * `locationLine` resolves `locationNames` by the snapshot `guestLanguage`
   * (the same language `PushService.notify` composes with) and appends the
   * spot, matching the hotel FE's `order-card.tsx` `destinationLabel`
   * formatting (`"{name} · {spot}"`); room deliveries pass null so the copy
   * falls back to its own room wording (23.4 AC2). `PushService.notify`
   * never throws (Task 6's guarantee), but this try/catch is defense in
   * depth at the call site, matching Task 7's `notifyPushSafely` — a push
   * failure must never fail an already-committed transition.
   */
  private async notifyOrderPushSafely(order: FnbOrder): Promise<void> {
    try {
      const lines = await this.linesRepo.find({
        where: { orderId: order.id },
      });
      const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
      const locationLine =
        order.destinationType === 'location' && order.locationNames
          ? `${localizeField(order.locationNames, order.guestLanguage)}${
              order.spot ? ` · ${order.spot}` : ''
            }`
          : null;
      await this.push.notify(order.hotelId, { stayIds: [order.stayId] }, 'order_status', {
        refId: order.id,
        vars: { id: order.id, itemCount, locationLine, status: order.status },
      });
    } catch (err) {
      this.logger.error(
        `push notify(order_status) failed for order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 26.4 AC2 ① — staff-assignment push. `PushService.notify` never throws
   * (Task 6's guarantee), but this try/catch is defense in depth at the call
   * site, matching `notifyOrderPushSafely` — a push failure must never fail
   * an already-committed transition.
   */
  private async notifyStaffSafely(
    hotelId: string,
    type: 'staff_assigned' | 'staff_available',
    target: Parameters<PushService['notify']>[1],
    vars: Record<string, unknown>,
    refId: string | null,
  ): Promise<void> {
    try {
      await this.push.notify(hotelId, target, type, { refId, vars });
    } catch (err) {
      this.logger.error(
        `push notify(${type}) failed for order ${refId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async findOrder(hotelId: string, id: string): Promise<FnbOrder> {
    const order = await this.ordersRepo.findOne({ where: { id, hotelId } });
    if (!order) {
      throw new NotFoundException({
        code: 'FNB_ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    return order;
  }

  /** 409 unless the transition map allows current → target (AC2). */
  private assertTransition(order: FnbOrder, target: FnbOrderStatus): void {
    if (!FNB_ORDER_TRANSITIONS[order.status]?.includes(target)) {
      throw new ConflictException({
        code: 'FNB_ORDER_INVALID_STATUS',
        message: `Order cannot move from ${order.status} to ${target}`,
        status: order.status,
      });
    }
  }

  /** Batch: lines + assignee names loaded per page — no pagination joins. */
  private async toViews(orders: FnbOrder[]): Promise<TenantFnbOrderView[]> {
    if (orders.length === 0) return [];
    const [lines, users] = await Promise.all([
      this.linesRepo.find({ where: { orderId: In(orders.map((o) => o.id)) } }),
      (async () => {
        const ids = [
          ...new Set(orders.map((o) => o.assignedToId).filter(Boolean)),
        ] as string[];
        return ids.length
          ? this.usersRepo.find({ where: { id: In(ids) } })
          : [];
      })(),
    ]);
    const linesByOrder = new Map<string, FnbOrderLine[]>();
    for (const line of lines) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push(line);
      linesByOrder.set(line.orderId, list);
    }
    const userById = new Map<string, TenantUser>(
      users.map((u) => [u.id, u] as [string, TenantUser]),
    );

    return orders.map((order) => ({
      id: order.id,
      roomNumber: order.roomNumber,
      guestName: order.guestName,
      guestLanguage: order.guestLanguage,
      stayId: order.stayId,
      destinationType: order.destinationType,
      locationId: order.locationId,
      locationNameEn: order.locationNames
        ? localized(order.locationNames, 'en')
        : null,
      locationNameAr: order.locationNames
        ? localized(order.locationNames, 'ar')
        : null,
      spot: order.spot,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      currency: order.currency,
      status: order.status,
      slaTargetMinutes: order.slaTargetMinutes,
      dueAt: order.dueAt,
      menuIds: order.menuIds,
      assignedTo: order.assignedToId
        ? {
            id: order.assignedToId,
            name: userById.get(order.assignedToId)?.name ?? '',
          }
        : null,
      createdAt: order.createdAt,
      startedAt: order.startedAt,
      outForDeliveryAt: order.outForDeliveryAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      cancelledReason: order.cancelledReason,
      cancelNote: order.cancelNote,
      settledAt: order.settledAt,
      updatedAt: order.updatedAt,
      lines: (linesByOrder.get(order.id) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({
          id: line.id,
          itemNameEn: localized(line.itemNames, 'en'),
          itemNameAr: localized(line.itemNames, 'ar'),
          itemName:
            line.itemNames[order.guestLanguage as keyof TranslationMap] ??
            localized(line.itemNames, 'en'),
          variantOptionNameEn: line.variantOptionNames
            ? localized(line.variantOptionNames, 'en')
            : null,
          variantOptionNameAr: line.variantOptionNames
            ? localized(line.variantOptionNames, 'ar')
            : null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          included: line.included,
          lineTotal: line.lineTotal,
          note: line.note,
        })),
    }));
  }

  private async audit(
    action: string,
    order: FnbOrder,
    actor: TenantUser,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'fnb_order',
      entityId: order.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        status: order.status,
        ...extra,
      },
    });
  }
}
