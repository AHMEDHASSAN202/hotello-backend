import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantRequestsService } from '../requests/tenant-requests.service';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { OverviewReport } from './report-views';
import { ReportPeriodError, honestDelta, previousWindow, resolvePeriod } from './reports-period';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsRevenueService } from './reports-revenue.service';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Story 22.1 — the Overview dashboard. Pure composition of the
 * operational/revenue/housekeeping/requests services already shipped in
 * Tasks B3a/B3b — this service computes nothing that one of them doesn't
 * already own (never re-derives `completedAt > dueAt` or settlement
 * eligibility). Not yet wired into `ReportsController` (Task B3d).
 */
@Injectable()
export class ReportsOverviewService {
  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    private readonly operational: ReportsOperationalService,
    private readonly revenue: ReportsRevenueService,
    private readonly housekeeping: HousekeepingService,
    private readonly requests: TenantRequestsService,
  ) {}

  async overview(
    hotelId: string,
    dto: ReportPeriodDto,
    includeRevenue: boolean,
    now: Date = new Date(),
  ): Promise<OverviewReport> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const timezone = hotel?.timezone ?? 'Africa/Cairo';
    let resolved;
    try {
      resolved = resolvePeriod(timezone, now, dto);
    } catch (err) {
      if (err instanceof ReportPeriodError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
    const period = { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days };
    const hotelCreatedAtLocalDate = hotelLocalParts(timezone, hotel!.createdAt).date;
    const prevWindow = previousWindow(resolved, timezone, now);
    const prevDto: ReportPeriodDto = { preset: 'custom', from: prevWindow.from, to: prevWindow.to };

    // ---- occupancy (now-state + simple period counts) ----
    const activeStays = await this.staysRepo.find({ where: { hotelId, status: 'active' } });
    const occupiedNow = activeStays.length;
    const totalRooms = hotel!.roomsCount;
    const pct = totalRooms > 0 ? round1((occupiedNow / totalRooms) * 100) : 0;
    const inHouseGuests = activeStays.reduce((sum, s) => sum + (s.guestsCount ?? 1), 0);
    const stayTypeBreakdown: Record<string, number> = {};
    for (const s of activeStays) stayTypeBreakdown[s.stayType] = (stayTypeBreakdown[s.stayType] ?? 0) + 1;
    const [arrivalsToday, departuresToday] = await Promise.all([
      this.operational.countArrivals(hotelId, resolved.fromDate, resolved.toDate),
      this.operational.countDepartures(hotelId, resolved.fromUtc, resolved.toUtcExclusive),
    ]);

    // ---- service (requests) ----
    const [requestsNow, requestsPrev, requestCounts] = await Promise.all([
      this.operational.requests(hotelId, dto, now),
      this.operational.requests(hotelId, prevDto, now),
      this.requests.counts(hotelId),
    ]);
    const received = honestDelta(requestsNow.receivedCount, requestsPrev.receivedCount, prevWindow.from, { hotelCreatedAtLocalDate });
    const completed = honestDelta(requestsNow.completedCount, requestsPrev.completedCount, prevWindow.from, { hotelCreatedAtLocalDate });
    const avgCompletionMinutes = honestDelta(
      requestsNow.overallAvgCompletionMinutes ?? 0,
      requestsPrev.overallAvgCompletionMinutes ?? 0,
      prevWindow.from,
      { hotelCreatedAtLocalDate },
    );
    const slaBreachRatePct = honestDelta(
      requestsNow.overallSlaBreachRatePct ?? 0,
      requestsPrev.overallSlaBreachRatePct ?? 0,
      prevWindow.from,
      { hotelCreatedAtLocalDate, isRatio: true, previousDenominator: requestsPrev.overallDoneWithSlaCount },
    );
    const topItems = [...requestsNow.byItem].sort((a, b) => b.count - a.count).slice(0, 5);

    // ---- housekeeping (now-state) ----
    const hkCounts = await this.housekeeping.counts(hotelId);

    const report: OverviewReport = {
      period,
      currency: hotel?.currency ?? 'EGP',
      occupancy: { occupiedNow, totalRooms, pct, arrivalsToday, departuresToday, inHouseGuests, stayTypeBreakdown },
      service: {
        received,
        completed,
        openNow: requestCounts.open,
        avgCompletionMinutes,
        slaBreachRatePct,
        topItems,
      },
      housekeeping: {
        cleanedToday: hkCounts.doneToday,
        needingCleaning: hkCounts.toCleanCheckout + hkCounts.toCleanDaily,
        inProgress: hkCounts.inProgress,
        dnd: hkCounts.dnd,
      },
    };

    if (includeRevenue) {
      const [diningNow, diningPrev, eventsNow, eventsPrev, totalsNow, totalsPrev] = await Promise.all([
        this.revenue.dining(hotelId, dto, now),
        this.revenue.dining(hotelId, prevDto, now),
        this.revenue.events(hotelId, dto, now),
        this.revenue.events(hotelId, prevDto, now),
        this.revenue.totals(hotelId, dto, now),
        this.revenue.totals(hotelId, prevDto, now),
      ]);
      report.revenue = {
        dining: honestDelta(diningNow.revenueTotal, diningPrev.revenueTotal, prevWindow.from, { hotelCreatedAtLocalDate }),
        events: honestDelta(eventsNow.totals.revenue, eventsPrev.totals.revenue, prevWindow.from, { hotelCreatedAtLocalDate }),
        total: honestDelta(totalsNow.grandTotal, totalsPrev.grandTotal, prevWindow.from, { hotelCreatedAtLocalDate }),
        cash: totalsNow.byMethod.cash,
        roomCharge: totalsNow.byMethod.roomCharge,
        unsettledTotal: totalsNow.outstanding,
        basis: 'delivered_booked',
      };
    }

    return report;
  }
}
