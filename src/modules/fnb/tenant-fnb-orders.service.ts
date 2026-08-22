import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { WILDCARD } from '../roles/permissions.constants';
import { startOfHotelDay } from '../tenant-stays/stay-time';
import { TenantStaysService } from '../tenant-stays/tenant-stays.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  AssignFnbOrderDto,
  CancelFnbOrderDto,
  ListTenantFnbOrdersQueryDto,
  SettleFnbOrdersDto,
} from './dto/tenant-fnb-orders.dto';
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

/**
 * Epic 16, Stories 16.7/16.8 — the kitchen board + lifecycle + room-charge
 * settlement. Mirrors the requests board contracts (delta polling drops the
 * status filter so finalized rows flow out; counts in one shape; the
 * options-endpoint assignment pattern) with the F&B transition map enforced
 * server-side. Lines are batch-loaded, never joined into pagination
 * (recorded two-pass pagination ruling).
 */
@Injectable()
export class TenantFnbOrdersService {
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
      ? { hotelId: user.hotelId, updatedAt: MoreThan(new Date(query.updatedSince)) }
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
    const [data, counts] = await Promise.all([
      this.toViews(orders),
      this.counts(user.hotelId),
    ]);
    return { data, counts, serverTime: new Date().toISOString() };
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
    return (await this.toViews([saved]))[0];
  }

  // ------------------------------------------------------------------
  // Stay orders + settlement (16.8)
  // ------------------------------------------------------------------

  /** The stay drawer's list + the "Unsettled room charges" line (AC1). */
  async stayOrders(
    user: TenantUser,
    stayId: string,
  ): Promise<{ data: TenantFnbOrderView[]; unsettledTotal: number }> {
    // Cross-tenant chokepoint: unknown/foreign stays 404 here.
    await this.stays.findStayInHotel(user.hotelId, stayId);
    const orders = await this.ordersRepo.find({
      where: { hotelId: user.hotelId, stayId },
      order: { createdAt: 'DESC' },
    });
    return {
      data: await this.toViews(orders),
      unsettledTotal: this.unsettledTotal(orders),
    };
  }

  /**
   * AC2 — bulk "mark as settled" at checkout. Idempotent: only delivered
   * room-charge orders with no settledAt move; a second call settles zero.
   * Auto-checkout never calls this — unsettled charges stay visible.
   */
  async settleStayOrders(
    user: TenantUser,
    stayId: string,
    dto: SettleFnbOrdersDto,
  ): Promise<{ settled: number; unsettledTotal: number }> {
    await this.stays.findStayInHotel(user.hotelId, stayId);
    const where: Record<string, unknown> = {
      hotelId: user.hotelId,
      stayId,
      status: 'delivered' as FnbOrderStatus,
      paymentMethod: 'room_charge',
      settledAt: IsNull(),
    };
    if (dto.orderIds?.length) where.id = In(dto.orderIds);
    const toSettle = await this.ordersRepo.find({ where });
    if (toSettle.length > 0) {
      const now = new Date();
      for (const order of toSettle) {
        order.settledAt = now;
        order.settledById = user.id;
      }
      await this.ordersRepo.save(toSettle);
      await this.auditLogs.log({
        action: 'fnb_orders.settled',
        entityType: 'stay',
        entityId: stayId,
        actorId: user.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: user.hotelId,
          orderIds: toSettle.map((o) => o.id),
          total: toSettle.reduce((sum, o) => sum + o.totalAmount, 0),
        },
      });
    }
    const remaining = await this.ordersRepo.find({
      where: { hotelId: user.hotelId, stayId },
    });
    return {
      settled: toSettle.length,
      unsettledTotal: this.unsettledTotal(remaining),
    };
  }

  private unsettledTotal(orders: FnbOrder[]): number {
    return (
      Math.round(
        orders
          .filter(
            (o) =>
              o.status === 'delivered' &&
              o.paymentMethod === 'room_charge' &&
              !o.settledAt,
          )
          .reduce((sum, o) => sum + o.totalAmount, 0) * 100,
      ) / 100
    );
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

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
