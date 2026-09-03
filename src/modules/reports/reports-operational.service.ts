import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { HousekeepingEvent } from '../housekeeping/housekeeping-event.entity';
import { Hotel } from '../hotels/hotel.entity';
import { RequestCategory } from '../requests/request-category.entity';
import { GuestRequest } from '../requests/request.entity';
import { daysBetween, hotelLocalParts, naiveUtc } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { StayRoomChange } from '../tenant-stays/stay-room-change.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { GuestsReport, HousekeepingReport, RequestsReport } from './report-views';
import { honestDelta, previousWindow, ReportPeriodError, resolvePeriod } from './reports-period';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Story 22.2 — the three "operational" detail reports (guests, requests,
 * housekeeping). Every method fetches the period's rows with ONE indexed
 * repository query and aggregates in plain TypeScript (repo convention —
 * see `FnbSettlementSource`/`HousekeepingService.toViews`); never raw SQL
 * date-bucketing. Not wired into `ReportsController` yet (Task B3d).
 */
@Injectable()
export class ReportsOperationalService {
  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @InjectRepository(StayRoomChange) private readonly roomChangesRepo: Repository<StayRoomChange>,
    @InjectRepository(GuestRequest) private readonly requestsRepo: Repository<GuestRequest>,
    @InjectRepository(RequestCategory) private readonly categoriesRepo: Repository<RequestCategory>,
    @InjectRepository(HousekeepingEvent) private readonly hkEventsRepo: Repository<HousekeepingEvent>,
    @InjectRepository(TenantUser) private readonly usersRepo: Repository<TenantUser>,
    private readonly housekeepingService: HousekeepingService,
  ) {}

  private async resolveOrThrow(hotelId: string, dto: ReportPeriodDto, now: Date) {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const timezone = hotel?.timezone ?? 'Africa/Cairo';
    try {
      const resolved = resolvePeriod(timezone, now, dto);
      return { hotel, timezone, resolved };
    } catch (err) {
      if (err instanceof ReportPeriodError) {
        throw new BadRequestException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- guests

  async guests(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<GuestsReport> {
    const { hotel, timezone, resolved } = await this.resolveOrThrow(hotelId, dto, now);
    const hotelCreatedAtLocalDate = hotelLocalParts(timezone, hotel!.createdAt).date;
    const prevWindow = previousWindow(resolved, timezone, now);

    const [arrivalsNow, arrivalsPrev, departuresNow, departuresPrev] = await Promise.all([
      this.countArrivals(hotelId, resolved.fromDate, resolved.toDate),
      this.countArrivals(hotelId, prevWindow.from, prevWindow.to),
      this.countDepartures(hotelId, resolved.fromUtc, resolved.toUtcExclusive),
      this.countDepartures(hotelId, prevWindow.fromUtc, prevWindow.toUtcExclusive),
    ]);

    const arrivals = honestDelta(arrivalsNow, arrivalsPrev, prevWindow.from, { hotelCreatedAtLocalDate });
    const departures = honestDelta(departuresNow, departuresPrev, prevWindow.from, { hotelCreatedAtLocalDate });

    const overlapping = await this.staysRepo
      .createQueryBuilder('s')
      .where('s.hotelId = :hotelId', { hotelId })
      .andWhere('s."checkInDate" <= :to', { to: resolved.toDate })
      .andWhere('s."checkOutDate" >= :from', { from: resolved.fromDate })
      .getMany();

    const departedInPeriod = overlapping.filter(
      (s) => s.status === 'checked_out' && s.checkedOutAt && s.checkedOutAt >= resolved.fromUtc && s.checkedOutAt < resolved.toUtcExclusive,
    );
    const avgLengthOfStayDays = departedInPeriod.length
      ? round1(
          departedInPeriod.reduce((sum, s) => sum + daysBetween(s.checkInDate, s.checkOutDate), 0) /
            departedInPeriod.length,
        )
      : null;

    const stayTypes: Record<string, number> = {};
    const languages: Record<string, number> = {};
    for (const s of overlapping) {
      stayTypes[s.stayType] = (stayTypes[s.stayType] ?? 0) + 1;
      languages[s.language] = (languages[s.language] ?? 0) + 1;
    }

    const totalRooms = hotel!.roomsCount;
    const occupancyTrend: { date: string; occupied: number; totalRooms: number }[] = [];
    for (let d = resolved.fromDate; d <= resolved.toDate; d = this.nextDate(d)) {
      const occupied = overlapping.filter((s) => s.checkInDate <= d && s.checkOutDate > d).length;
      occupancyTrend.push({ date: d, occupied, totalRooms });
    }

    const [inHouseNow, roomChanges] = await Promise.all([
      this.staysRepo.count({ where: { hotelId, status: 'active' } }),
      this.roomChangesRepo.count({
        where: { hotelId, occurredAt: Between(resolved.fromUtc, resolved.toUtcExclusive) },
      }),
    ]);

    return {
      period: { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days },
      arrivals,
      departures,
      inHouseNow,
      avgLengthOfStayDays,
      occupancyTrend,
      stayTypes,
      languages,
      roomChanges,
    };
  }

  /** Package-internal, not `private`: `ReportsOverviewService` calls this exact query shape directly. */
  async countArrivals(hotelId: string, fromDate: string, toDate: string): Promise<number> {
    return this.staysRepo
      .createQueryBuilder('s')
      .where('s.hotelId = :hotelId', { hotelId })
      .andWhere('s."checkInDate" BETWEEN :from AND :to', { from: fromDate, to: toDate })
      .getCount();
  }

  /** Package-internal, not `private`: `ReportsOverviewService` calls this exact query shape directly. */
  async countDepartures(hotelId: string, fromUtc: Date, toUtcExclusive: Date): Promise<number> {
    return this.staysRepo.count({
      where: { hotelId, status: 'checked_out', checkedOutAt: Between(fromUtc, toUtcExclusive) },
    });
  }

  /** 'YYYY-MM-DD' + 1 day, pure string/date arithmetic (no timezone conversion needed — see reports-period.ts's own use of this shape). */
  private nextDate(d: string): string {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  }

  // -------------------------------------------------------------- requests

  async requests(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<RequestsReport> {
    const { timezone, resolved } = await this.resolveOrThrow(hotelId, dto, now);

    const rows = await this.requestsRepo.find({
      where: { hotelId, createdAt: Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)) },
    });

    const volumeByDayMap = new Map<string, number>();
    const busiestHours = new Array(24).fill(0);
    const byCategoryAgg = new Map<
      string,
      { count: number; doneWithSla: number; breaches: number; completionMinutesSum: number; completionCount: number }
    >();
    const byItemAgg = new Map<string, { names: Record<string, string>; count: number }>();
    const completionBuckets = { '<15m': 0, '15-30m': 0, '30-60m': 0, '1-2h': 0, '>2h': 0 };
    const cancelReasons = new Map<string, number>();
    let cancelledCount = 0;
    // Hotel-wide counterparts to the per-category `cat.*` accumulators below —
    // kept alongside them (same loop, same branch) so the overall SLA breach
    // rate is a true "breaches / done-with-SLA" ratio across ALL categories,
    // never an average of the per-category percentages (that would silently
    // misweight categories with different sample sizes).
    let completedCount = 0;
    let overallDoneWithSlaCount = 0;
    let overallBreaches = 0;
    let overallCompletionMinutesSum = 0;

    for (const r of rows) {
      const local = hotelLocalParts(timezone, r.createdAt);
      volumeByDayMap.set(local.date, (volumeByDayMap.get(local.date) ?? 0) + 1);
      busiestHours[Math.floor(local.minutes / 60)] += 1;

      const cat = byCategoryAgg.get(r.categoryId) ?? { count: 0, doneWithSla: 0, breaches: 0, completionMinutesSum: 0, completionCount: 0 };
      cat.count += 1;
      byCategoryAgg.set(r.categoryId, cat);

      const item = byItemAgg.get(r.itemId) ?? { names: r.itemNames, count: 0 };
      item.count += 1;
      byItemAgg.set(r.itemId, item);

      if (r.status === 'done' && r.completedAt) {
        completedCount += 1;
        cat.doneWithSla += 1;
        overallDoneWithSlaCount += 1;
        if (r.completedAt > r.dueAt) {
          cat.breaches += 1;
          overallBreaches += 1;
        }
        const minutes = (r.completedAt.getTime() - r.createdAt.getTime()) / 60000;
        cat.completionMinutesSum += minutes;
        cat.completionCount += 1;
        overallCompletionMinutesSum += minutes;
        if (minutes < 15) completionBuckets['<15m'] += 1;
        else if (minutes < 30) completionBuckets['15-30m'] += 1;
        else if (minutes < 60) completionBuckets['30-60m'] += 1;
        else if (minutes < 120) completionBuckets['1-2h'] += 1;
        else completionBuckets['>2h'] += 1;
      }
      if (r.status === 'cancelled') {
        cancelledCount += 1;
        const reason = r.cancelledReason ?? 'unknown';
        cancelReasons.set(reason, (cancelReasons.get(reason) ?? 0) + 1);
      }
    }

    const categoryIds = [...byCategoryAgg.keys()];
    const categories = categoryIds.length ? await this.categoriesRepo.find({ where: { id: In(categoryIds) } }) : [];
    const categoryNames = new Map(categories.map((c) => [c.id, c.names]));

    return {
      period: { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days },
      receivedCount: rows.length,
      completedCount,
      overallDoneWithSlaCount,
      overallSlaBreachRatePct: overallDoneWithSlaCount > 0 ? round1((overallBreaches / overallDoneWithSlaCount) * 100) : null,
      overallAvgCompletionMinutes: overallDoneWithSlaCount > 0 ? round1(overallCompletionMinutesSum / overallDoneWithSlaCount) : null,
      volumeByDay: [...volumeByDayMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byCategory: categoryIds.map((categoryId) => {
        const agg = byCategoryAgg.get(categoryId)!;
        return {
          categoryId,
          names: (categoryNames.get(categoryId) ?? {}) as Record<string, string>,
          count: agg.count,
          slaCompliancePct: agg.doneWithSla > 0 ? round1(((agg.doneWithSla - agg.breaches) / agg.doneWithSla) * 100) : null,
          avgCompletionMinutes: agg.completionCount > 0 ? round1(agg.completionMinutesSum / agg.completionCount) : null,
        };
      }),
      byItem: [...byItemAgg.entries()].map(([itemId, v]) => ({ itemId, names: v.names, count: v.count })),
      completionBuckets: (Object.keys(completionBuckets) as (keyof typeof completionBuckets)[]).map((label) => ({
        label,
        count: completionBuckets[label],
      })),
      cancellations: {
        count: cancelledCount,
        reasons: [...cancelReasons.entries()].map(([reason, count]) => ({ reason, count })),
      },
      busiestHours,
    };
  }

  // ---------------------------------------------------------- housekeeping

  async housekeeping(hotelId: string, dto: ReportPeriodDto, now: Date = new Date()): Promise<HousekeepingReport> {
    const { timezone, resolved } = await this.resolveOrThrow(hotelId, dto, now);

    // 3-day lookback so a clean completed early in the period can still pair
    // with a flag raised just before it started (see the pairing note below).
    const lookbackFrom = new Date(resolved.fromUtc.getTime() - 3 * 24 * 60 * 60 * 1000);
    const events = await this.hkEventsRepo.find({
      where: { hotelId, occurredAt: Between(lookbackFrom, resolved.toUtcExclusive) },
      order: { occurredAt: 'ASC' },
    });

    const inPeriod = (e: HousekeepingEvent) => e.occurredAt >= resolved.fromUtc && e.occurredAt < resolved.toUtcExclusive;

    const cleanedByDayMap = new Map<string, { checkout: number; daily: number }>();
    const attendantCounts = new Map<string, number>();
    let dndClearedCount = 0;
    for (const e of events) {
      if (!inPeriod(e)) continue;
      if (e.eventType === 'completed') {
        const date = hotelLocalParts(timezone, e.occurredAt).date;
        const bucket = cleanedByDayMap.get(date) ?? { checkout: 0, daily: 0 };
        if (e.cleaningType === 'checkout') bucket.checkout += 1;
        else if (e.cleaningType === 'daily') bucket.daily += 1;
        cleanedByDayMap.set(date, bucket);

        const attendantId = e.assignedToId ?? e.actorId;
        if (attendantId) attendantCounts.set(attendantId, (attendantCounts.get(attendantId) ?? 0) + 1);
      }
      if (e.eventType === 'dnd_cleared') dndClearedCount += 1;
    }

    // Flag-to-clean pairing: process the WHOLE fetched window (incl. lookback)
    // in chronological order per room; only durations for a 'completed' event
    // that itself falls inside the true period are counted into the average.
    const openFlagAt = new Map<string, Date>();
    let durationSum = 0;
    let durationCount = 0;
    for (const e of events) {
      if (e.eventType === 'flagged') {
        openFlagAt.set(e.roomId, e.occurredAt);
      } else if (e.eventType === 'completed') {
        const flaggedAt = openFlagAt.get(e.roomId);
        if (flaggedAt && inPeriod(e)) {
          durationSum += (e.occurredAt.getTime() - flaggedAt.getTime()) / 60000;
          durationCount += 1;
        }
        openFlagAt.delete(e.roomId);
      } else if (e.eventType === 'cleared') {
        openFlagAt.delete(e.roomId);
      }
      // 'started'/'interrupted'/'dnd_set'/'dnd_cleared' don't touch the open flag.
    }

    const attendantIds = [...attendantCounts.keys()];
    const attendantUsers = attendantIds.length ? await this.usersRepo.find({ where: { id: In(attendantIds) } }) : [];
    const nameFor = new Map(attendantUsers.map((u) => [u.id, u.name]));

    const earliest = await this.hkEventsRepo.findOne({ where: { hotelId }, order: { occurredAt: 'ASC' } });
    const dataSinceLocalDate = earliest ? hotelLocalParts(timezone, earliest.occurredAt).date : undefined;
    const dataSince = dataSinceLocalDate && dataSinceLocalDate > resolved.fromDate ? dataSinceLocalDate : undefined;

    const nowCounts = await this.housekeepingService.counts(hotelId);

    return {
      period: { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days },
      cleanedByDay: [...cleanedByDayMap.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      avgFlagToCleanMinutes: durationCount > 0 ? round1(durationSum / durationCount) : null,
      attendants: attendantIds.map((userId) => ({
        userId,
        name: nameFor.get(userId) ?? '',
        completed: attendantCounts.get(userId)!,
        perDay: round1(attendantCounts.get(userId)! / resolved.days),
      })),
      dndClearedCount,
      dndNow: nowCounts.dnd,
      dataSince,
    };
  }
}
