import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { StaySettlementService } from '../stay-settlement/stay-settlement.service';
import { Room } from '../tenant-rooms/room.entity';
import { hotelLocalParts } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { BalanceRow, BalancesReport, LeakageReport, LeakageRow } from './report-views';
import { ReportPeriodError, resolvePeriod } from './reports-period';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Story 22.4 — the outstanding-balances view and its historical "leakage"
 * counterpart. Never re-implements the balance calculation: every number
 * here comes from `StaySettlementService.unsettledByStay`, the same method
 * the rooms/stays list badges (Task B2d) and the checkout interlock
 * (Epic 16.8/21.6) call — one source of truth (epic Implementation Note 2).
 */
@Injectable()
export class ReportsBalancesService {
  constructor(
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Room) private readonly roomsRepo: Repository<Room>,
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    private readonly staySettlement: StaySettlementService,
  ) {}

  /**
   * 22.4 AC1/AC2 — active stays with unsettled charges, sorted by checkout
   * date ascending (today's departures first). `now` is an injectable clock
   * for tests (the `HousekeepingSchedulerService.runDailyService` precedent).
   */
  async balances(hotelId: string, now: Date = new Date()): Promise<BalancesReport> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const currency = hotel?.currency ?? 'EGP';
    const summaries = await this.staySettlement.unsettledByStay(hotelId);
    if (summaries.size === 0) {
      return { currency, departingTodayCount: 0, departingTodayTotal: 0, totalOutstanding: 0, rows: [] };
    }

    const stayIds = [...summaries.keys()];
    const stays = await this.staysRepo.find({
      where: { id: In(stayIds), hotelId, status: 'active' },
    });
    if (stays.length === 0) {
      return { currency, departingTodayCount: 0, departingTodayTotal: 0, totalOutstanding: 0, rows: [] };
    }

    const roomIds = [...new Set(stays.map((s) => s.roomId))];
    const rooms = await this.roomsRepo.find({ where: { id: In(roomIds) } });
    const roomNumberFor = new Map(rooms.map((r) => [r.id, r.roomNumber]));
    const today = hotelLocalParts(hotel?.timezone ?? 'Africa/Cairo', now).date;

    const rows: BalanceRow[] = stays
      .map((stay): BalanceRow => {
        const summary = summaries.get(stay.id)!;
        return {
          stayId: stay.id,
          roomId: stay.roomId,
          roomNumber: roomNumberFor.get(stay.roomId) ?? '',
          guestName: stay.guestName,
          checkOutDate: stay.checkOutDate,
          departsToday: stay.checkOutDate === today,
          total: summary.total,
          byKey: { fnb: summary.byKey.fnb ?? 0, events: summary.byKey.events ?? 0 },
          oldestUnsettledAt: summary.oldestUnsettledAt.toISOString(),
        };
      })
      .sort((a, b) => a.checkOutDate.localeCompare(b.checkOutDate));

    const departingToday = rows.filter((r) => r.departsToday);
    return {
      currency,
      departingTodayCount: departingToday.length,
      departingTodayTotal: round2(departingToday.reduce((sum, r) => sum + r.total, 0)),
      totalOutstanding: round2(rows.reduce((sum, r) => sum + r.total, 0)),
      rows,
    };
  }

  /**
   * 22.4 AC5 — the "actual loss ledger": stays that checked out (any type,
   * including the 16.8 auto-checkout path) within the period and left an
   * unsettled balance. `resolvePeriod`/`ReportPeriodError` come from Task
   * B1a; period-resolution errors surface as 400s directly from the service
   * (the existing repo convention — e.g. HousekeepingService throws
   * ConflictException/NotFoundException from the service layer, not the
   * controller).
   */
  async leakage(
    hotelId: string,
    dto: ReportPeriodDto,
    now: Date = new Date(),
  ): Promise<LeakageReport> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    const currency = hotel?.currency ?? 'EGP';
    const timezone = hotel?.timezone ?? 'Africa/Cairo';

    let resolved;
    try {
      resolved = resolvePeriod(timezone, now, dto);
    } catch (err) {
      if (err instanceof ReportPeriodError) {
        throw new BadRequestException({ code: err.code, message: err.message });
      }
      throw err;
    }
    const period = { preset: dto.preset, from: resolved.fromDate, to: resolved.toDate, days: resolved.days };

    const stays = await this.staysRepo.find({
      where: {
        hotelId,
        status: 'checked_out',
        checkedOutAt: Between(resolved.fromUtc, resolved.toUtcExclusive),
      },
    });
    if (stays.length === 0) {
      return { period, currency, totalLost: 0, rows: [] };
    }

    const stayIds = stays.map((s) => s.id);
    const summaries = await this.staySettlement.unsettledByStay(hotelId, stayIds);
    const roomIds = [...new Set(stays.map((s) => s.roomId))];
    const rooms = await this.roomsRepo.find({ where: { id: In(roomIds) } });
    const roomNumberFor = new Map(rooms.map((r) => [r.id, r.roomNumber]));

    const rows: LeakageRow[] = stays
      .filter((s) => summaries.has(s.id))
      .map((s): LeakageRow => {
        const summary = summaries.get(s.id)!;
        return {
          stayId: s.id,
          roomNumber: roomNumberFor.get(s.roomId) ?? '',
          guestName: s.guestName,
          checkedOutAt: s.checkedOutAt!.toISOString(),
          checkoutType: s.checkoutType!,
          total: summary.total,
          byKey: { fnb: summary.byKey.fnb ?? 0, events: summary.byKey.events ?? 0 },
        };
      });

    return {
      period,
      currency,
      totalLost: round2(rows.reduce((sum, r) => sum + r.total, 0)),
      rows,
    };
  }
}
