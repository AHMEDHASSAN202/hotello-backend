import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { EventSettlementSource } from '../events/event-settlement-source';
import { EventBooking } from '../events/event-booking.entity';
import { Event } from '../events/event.entity';
import { FnbSettlementSource } from '../fnb/fnb-settlement-source';
import { FnbOrderLine } from '../fnb/fnb-order-line.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { UnsettledStayLine } from '../stay-settlement/settlement-source.interface';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { ReportPeriodDto } from './dto/report-period.dto';
import { DiningReport, EventPerformance, EventsReport, TotalsReport } from './report-views';
import { ReportPeriodError, resolvePeriod, ResolvedPeriod } from './reports-period';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Story 22.3 — the three revenue reports (dining, events, totals). Same
 * fetch-in-period-then-aggregate-in-memory style as `ReportsOperationalService`
 * (Task B3a). Not wired into `ReportsController` yet (Task B3d).
 *
 * Revenue basis (dining): delivered orders only, keyed on `deliveredAt` —
 * the `TenantFnbOrdersService.counts()` `revenueToday` precedent, generalized
 * from "today" to an arbitrary period. Cancelled orders are fetched
 * separately (by `cancelledAt`) purely for the cancellations breakdown.
 *
 * Revenue basis (events): events whose `startAtLocal` falls in the period —
 * every booking on a matching event counts toward that event's totals
 * regardless of when the booking itself was made.
 *
 * "Never re-implement a metric": settlement eligibility is never re-derived
 * here. `totals()`'s `outstanding` figure calls
 * `FnbSettlementSource.findUnsettledByStay`/`EventSettlementSource.findUnsettledByStay`
 * directly (the same Task B2a methods `StaySettlementService.unsettledByStay`
 * is built on) instead of re-checking `paymentMethod === 'room_charge' &&
 * !settledAt` inline — that predicate lives in exactly one place (`isEligible`
 * on each source). `totals()`'s `collected` figure, by contrast, is a
 * genuinely new aggregation — it's fine to compute directly from the
 * already-fetched period rows by checking `settledAt !== null`, since that's
 * the complement of the sources' own eligibility check, not a
 * re-implementation of it.
 */
@Injectable()
export class ReportsRevenueService {
  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(FnbOrder) private readonly ordersRepo: Repository<FnbOrder>,
    @InjectRepository(FnbOrderLine) private readonly linesRepo: Repository<FnbOrderLine>,
    @InjectRepository(Event) private readonly eventsRepo: Repository<Event>,
    @InjectRepository(EventBooking) private readonly bookingsRepo: Repository<EventBooking>,
    private readonly fnbSettlement: FnbSettlementSource,
    private readonly eventSettlement: EventSettlementSource,
  ) {}

  private async resolveOrThrow(hotelId: string, dto: ReportPeriodDto, now: Date) {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const timezone = hotel?.timezone ?? 'Africa/Cairo';
    try {
      return { hotel, timezone, resolved: resolvePeriod(timezone, now, dto) };
    } catch (err) {
      if (err instanceof ReportPeriodError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
  }

  private periodView(dto: ReportPeriodDto, resolved: ResolvedPeriod) {
    return { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days };
  }

  // ------------------------------------------------------------- fetchers

  private fetchDeliveredOrders(hotelId: string, resolved: ResolvedPeriod) {
    return this.ordersRepo.find({
      where: { hotelId, status: 'delivered', deliveredAt: Between(resolved.fromUtc, resolved.toUtcExclusive) },
    });
  }

  private fetchCancelledOrders(hotelId: string, resolved: ResolvedPeriod) {
    return this.ordersRepo.find({
      where: { hotelId, status: 'cancelled', cancelledAt: Between(resolved.fromUtc, resolved.toUtcExclusive) },
    });
  }

  /** Events whose `startAtLocal` falls in the period, plus ALL their bookings (any status/createdAt — an event's performance is reported once, for its own start date, regardless of when its bookings were made). */
  private async fetchPeriodEvents(
    hotelId: string,
    resolved: ResolvedPeriod,
  ): Promise<{ events: Event[]; bookingsByEvent: Map<string, EventBooking[]> }> {
    const candidates = await this.eventsRepo.find({
      where: { hotelId, status: In(['published', 'completed']) },
    });
    const fromStamp = `${resolved.fromDate} 00:00`;
    const toStamp = `${resolved.toDate} 23:59`;
    const events = candidates.filter((e) => e.startAtLocal >= fromStamp && e.startAtLocal <= toStamp);
    if (events.length === 0) return { events: [], bookingsByEvent: new Map() };

    const eventIds = events.map((e) => e.id);
    const bookings = await this.bookingsRepo.find({ where: { eventId: In(eventIds) } });
    const bookingsByEvent = new Map<string, EventBooking[]>();
    for (const b of bookings) {
      const arr = bookingsByEvent.get(b.eventId) ?? [];
      arr.push(b);
      bookingsByEvent.set(b.eventId, arr);
    }
    return { events, bookingsByEvent };
  }

  private summarizeEvent(event: Event, bookings: EventBooking[]): EventPerformance {
    const active = bookings.filter((b) => b.status === 'booked');
    const booked = active.reduce((sum, b) => sum + b.partySize, 0);
    const revenue = round2(active.filter((b) => !b.included).reduce((sum, b) => sum + b.totalAmount, 0));
    const paidSeats = active.filter((b) => !b.included && b.unitPrice > 0).reduce((sum, b) => sum + b.partySize, 0);
    const freeSeats = active.filter((b) => !b.included && b.unitPrice === 0).reduce((sum, b) => sum + b.partySize, 0);
    const includedSeats = active.filter((b) => b.included).reduce((sum, b) => sum + b.partySize, 0);
    const cancelled = bookings.filter((b) => b.status === 'cancelled').length;
    const cancellationRatePct = bookings.length > 0 ? round2((cancelled / bookings.length) * 100) : 0;
    return {
      eventId: event.id,
      titles: event.titles,
      startAtLocal: event.startAtLocal,
      capacity: event.capacity,
      booked,
      revenue,
      paidSeats,
      freeSeats,
      includedSeats,
      cancellationRatePct,
    };
  }

  // -------------------------------------------------------------- dining

  async dining(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<DiningReport> {
    const { hotel, timezone, resolved } = await this.resolveOrThrow(hotelId, dto, now);
    const currency = hotel?.currency ?? 'EGP';

    const [delivered, cancelled] = await Promise.all([
      this.fetchDeliveredOrders(hotelId, resolved),
      this.fetchCancelledOrders(hotelId, resolved),
    ]);

    const revenueByDayMap = new Map<string, { revenue: number; orders: number }>();
    const byZoneMap = new Map<string, { destinationType: 'room' | 'location'; locationKey: string | null; names: Record<string, string> | null; revenue: number; orders: number }>();
    let cash = 0;
    let roomCharge = 0;
    for (const o of delivered) {
      const date = hotelLocalParts(timezone, o.deliveredAt!).date;
      const day = revenueByDayMap.get(date) ?? { revenue: 0, orders: 0 };
      day.revenue = round2(day.revenue + o.totalAmount);
      day.orders += 1;
      revenueByDayMap.set(date, day);

      const zoneKey = o.destinationType === 'room' ? 'room' : `location:${o.locationKey}`;
      const zone = byZoneMap.get(zoneKey) ?? {
        destinationType: o.destinationType,
        locationKey: o.destinationType === 'location' ? o.locationKey : null,
        names: o.destinationType === 'location' ? o.locationNames : null,
        revenue: 0,
        orders: 0,
      };
      zone.revenue = round2(zone.revenue + o.totalAmount);
      zone.orders += 1;
      byZoneMap.set(zoneKey, zone);

      if (o.paymentMethod === 'cash') cash = round2(cash + o.totalAmount);
      else if (o.paymentMethod === 'room_charge') roomCharge = round2(roomCharge + o.totalAmount);
    }

    const orderIds = delivered.map((o) => o.id);
    const lines = orderIds.length ? await this.linesRepo.find({ where: { orderId: In(orderIds) } }) : [];
    const topItemsMap = new Map<string, { names: Record<string, string>; qty: number; revenue: number }>();
    const consumptionMap = new Map<string, { names: Record<string, string>; qty: number }>();
    for (const line of lines) {
      if (line.included) {
        const c = consumptionMap.get(line.itemId) ?? { names: line.itemNames as Record<string, string>, qty: 0 };
        c.qty += line.quantity;
        consumptionMap.set(line.itemId, c);
      } else {
        const t = topItemsMap.get(line.itemId) ?? { names: line.itemNames as Record<string, string>, qty: 0, revenue: 0 };
        t.qty += line.quantity;
        t.revenue = round2(t.revenue + line.lineTotal);
        topItemsMap.set(line.itemId, t);
      }
    }

    const paidOrders = delivered.filter((o) => o.totalAmount > 0);
    const revenueTotal = round2(delivered.reduce((sum, o) => sum + o.totalAmount, 0));

    const cancelReasons = new Map<string, number>();
    for (const o of cancelled) {
      const reason = o.cancelledReason ?? 'unknown';
      cancelReasons.set(reason, (cancelReasons.get(reason) ?? 0) + 1);
    }

    return {
      period: this.periodView(dto, resolved),
      currency,
      revenueByDay: [...revenueByDayMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      ordersCount: delivered.length,
      revenueTotal,
      avgOrderValue: paidOrders.length ? round2(revenueTotal / paidOrders.length) : null,
      topItems: [...topItemsMap.entries()].map(([itemId, v]) => ({ itemId, ...v })).sort((a, b) => b.revenue - a.revenue),
      includedConsumption: [...consumptionMap.entries()].map(([itemId, v]) => ({ itemId, ...v })),
      byZone: [...byZoneMap.values()],
      paymentSplit: { cash, roomCharge },
      cancellations: { count: cancelled.length, reasons: [...cancelReasons.entries()].map(([reason, count]) => ({ reason, count })) },
      basis: 'delivered_only',
    };
  }

  // -------------------------------------------------------------- events

  async events(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<EventsReport> {
    const { hotel, resolved } = await this.resolveOrThrow(hotelId, dto, now);
    const currency = hotel?.currency ?? 'EGP';
    const { events, bookingsByEvent } = await this.fetchPeriodEvents(hotelId, resolved);

    const performances = events
      .map((e) => this.summarizeEvent(e, bookingsByEvent.get(e.id) ?? []))
      .sort((a, b) => b.revenue - a.revenue);

    const allBookings = [...bookingsByEvent.values()].flat();
    const totalRevenue = round2(performances.reduce((sum, p) => sum + p.revenue, 0));
    const totalBooked = performances.reduce((sum, p) => sum + p.booked, 0);
    const totalCancelled = allBookings.filter((b) => b.status === 'cancelled').length;
    const cancellationRatePct = allBookings.length > 0 ? round2((totalCancelled / allBookings.length) * 100) : 0;

    return {
      period: this.periodView(dto, resolved),
      currency,
      events: performances,
      totals: { revenue: totalRevenue, booked: totalBooked, cancellationRatePct },
      basis: 'events_starting_in_period',
    };
  }

  // -------------------------------------------------------------- totals

  async totals(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<TotalsReport> {
    const { hotel, resolved } = await this.resolveOrThrow(hotelId, dto, now);
    const currency = hotel?.currency ?? 'EGP';

    const [delivered, { events, bookingsByEvent }] = await Promise.all([
      this.fetchDeliveredOrders(hotelId, resolved),
      this.fetchPeriodEvents(hotelId, resolved),
    ]);

    const byDayMap = new Map<string, { dining: number; events: number }>();
    let diningCash = 0, diningRoomCharge = 0, diningCollected = 0;
    const timezoneHotel = hotel?.timezone ?? 'Africa/Cairo';
    for (const o of delivered) {
      const date = hotelLocalParts(timezoneHotel, o.deliveredAt!).date;
      const entry = byDayMap.get(date) ?? { dining: 0, events: 0 };
      entry.dining = round2(entry.dining + o.totalAmount);
      byDayMap.set(date, entry);
      if (o.paymentMethod === 'cash') {
        diningCash = round2(diningCash + o.totalAmount);
        diningCollected = round2(diningCollected + o.totalAmount);
      } else if (o.paymentMethod === 'room_charge') {
        diningRoomCharge = round2(diningRoomCharge + o.totalAmount);
        if (o.settledAt) diningCollected = round2(diningCollected + o.totalAmount);
      }
    }

    let eventsCash = 0, eventsRoomCharge = 0, eventsCollected = 0, eventsRevenue = 0;
    for (const e of events) {
      const bookings = (bookingsByEvent.get(e.id) ?? []).filter((b) => b.status === 'booked' && !b.included);
      const date = e.startAtLocal.slice(0, 10);
      const entry = byDayMap.get(date) ?? { dining: 0, events: 0 };
      for (const b of bookings) {
        entry.events = round2(entry.events + b.totalAmount);
        eventsRevenue = round2(eventsRevenue + b.totalAmount);
        if (b.paymentMethod === 'cash') {
          eventsCash = round2(eventsCash + b.totalAmount);
          eventsCollected = round2(eventsCollected + b.totalAmount);
        } else if (b.paymentMethod === 'room_charge') {
          eventsRoomCharge = round2(eventsRoomCharge + b.totalAmount);
          if (b.settledAt) eventsCollected = round2(eventsCollected + b.totalAmount);
        }
      }
      byDayMap.set(date, entry);
    }

    const [fnbUnsettled, eventUnsettled] = await Promise.all([
      this.fnbSettlement.findUnsettledByStay(hotelId),
      this.eventSettlement.findUnsettledByStay(hotelId),
    ]);
    const inPeriodOutstanding = (map: Map<string, UnsettledStayLine[]>) => {
      let sum = 0;
      for (const lines of map.values()) {
        for (const line of lines) {
          if (line.createdAt >= resolved.fromUtc && line.createdAt < resolved.toUtcExclusive) sum += line.totalAmount;
        }
      }
      return sum;
    };
    const outstanding = round2(inPeriodOutstanding(fnbUnsettled) + inPeriodOutstanding(eventUnsettled));

    return {
      period: this.periodView(dto, resolved),
      currency,
      byDay: [...byDayMap.entries()]
        .map(([date, v]) => ({ date, dining: v.dining, events: v.events, total: round2(v.dining + v.events) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byMethod: { cash: round2(diningCash + eventsCash), roomCharge: round2(diningRoomCharge + eventsRoomCharge) },
      grandTotal: round2(delivered.reduce((s, o) => s + o.totalAmount, 0) + eventsRevenue),
      collected: round2(diningCollected + eventsCollected),
      outstanding,
      basis: 'delivered_booked',
    };
  }
}
