import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventBooking } from '../events/event-booking.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { GuestRequest } from '../requests/request.entity';
import { fromNaive, naiveUtc } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { toCsv } from './csv/csv-writer';
import { ReportPeriodDto } from './dto/report-period.dto';
import { ReportPeriodError, resolvePeriod } from './reports-period';
import { canReadRevenue } from './reports-access';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsOverviewService } from './reports-overview.service';
import { ReportsRevenueService } from './reports-revenue.service';
import * as adapters from './xlsx/report-sheet-adapters';
import { ReportsXlsxService } from './xlsx/reports-xlsx.service';

const REPORT_NAMES = ['overview', 'guests', 'requests', 'housekeeping', 'dining', 'events', 'totals', 'balances', 'leakage'] as const;
type ReportName = (typeof REPORT_NAMES)[number];
const FEED_NAMES = ['stays-feed', 'requests-feed', 'orders-feed', 'bookings-feed'] as const;
type FeedName = (typeof FEED_NAMES)[number];
const REVENUE_CLASSIFIED = new Set(['dining', 'events', 'totals', 'orders-feed', 'bookings-feed']);
const ROW_CAP = 10000;

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Story 22.5 — orchestrates every report/feed export behind a single
 * `:report` path segment (scoping decision 1: no `format` query param, the
 * name alone decides xlsx vs csv). Buffers are built in memory and streamed
 * straight to the response by the controller — nothing here ever persists a
 * generated file (repo-wide rule for QR/PDF/Excel).
 */
@Injectable()
export class ReportsExportService {
  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @InjectRepository(GuestRequest) private readonly requestsRepo: Repository<GuestRequest>,
    @InjectRepository(FnbOrder) private readonly ordersRepo: Repository<FnbOrder>,
    @InjectRepository(EventBooking) private readonly bookingsRepo: Repository<EventBooking>,
    private readonly xlsx: ReportsXlsxService,
    private readonly balances: ReportsBalancesService,
    private readonly operational: ReportsOperationalService,
    private readonly revenue: ReportsRevenueService,
    private readonly overview: ReportsOverviewService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async export(user: TenantUser, report: string, dto: ReportPeriodDto): Promise<ExportResult> {
    if (REVENUE_CLASSIFIED.has(report) && !canReadRevenue(user)) {
      throw new ForbiddenException({ code: 'REPORTS_REVENUE_FORBIDDEN', message: 'This export requires revenue access' });
    }

    const hotel = await this.hotelsRepo.findOne({ where: { id: user.hotelId } });
    if (!hotel) throw new NotFoundException({ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found' });
    const timezone = hotel.timezone ?? 'Africa/Cairo';
    let resolved;
    try {
      resolved = resolvePeriod(timezone, new Date(), dto);
    } catch (err) {
      if (err instanceof ReportPeriodError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }

    let result: ExportResult;
    if ((REPORT_NAMES as readonly string[]).includes(report)) {
      result = await this.exportReport(user, report as ReportName, dto, hotel, resolved);
    } else if ((FEED_NAMES as readonly string[]).includes(report)) {
      result = await this.exportFeed(user, report as FeedName, resolved, hotel);
    } else {
      throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: `Unknown report: ${report}` });
    }

    await this.auditLogs.log({
      action: 'report.exported',
      entityType: 'report',
      entityId: user.hotelId,
      actorId: user.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: user.hotelId,
        report,
        format: result.contentType.includes('csv') ? 'csv' : 'xlsx',
        from: resolved.fromDate,
        to: resolved.toDate,
      },
    });

    return result;
  }

  private buildFilename(hotelSlug: string, report: string, from: string, to: string, ext: string): string {
    return `${hotelSlug}-${report}-${from}-${to}.${ext}`;
  }

  private async exportReport(
    user: TenantUser,
    report: ReportName,
    dto: ReportPeriodDto,
    hotel: Hotel,
    resolved: ReturnType<typeof resolvePeriod>,
  ): Promise<ExportResult> {
    const basisLine = this.basisLineFor(report);
    let sheets;
    switch (report) {
      case 'overview':
        sheets = adapters.overviewSheets(await this.overview.overview(user.hotelId, dto, canReadRevenue(user)));
        break;
      case 'guests':
        sheets = adapters.guestsSheets(await this.operational.guests(user.hotelId, dto));
        break;
      case 'requests':
        sheets = adapters.requestsSheets(await this.operational.requests(user.hotelId, dto));
        break;
      case 'housekeeping':
        sheets = adapters.housekeepingSheets(await this.operational.housekeeping(user.hotelId, dto));
        break;
      case 'dining':
        sheets = adapters.diningSheets(await this.revenue.dining(user.hotelId, dto));
        break;
      case 'events':
        sheets = adapters.eventsSheets(await this.revenue.events(user.hotelId, dto));
        break;
      case 'totals':
        sheets = adapters.totalsSheets(await this.revenue.totals(user.hotelId, dto));
        break;
      case 'balances': {
        const balancesReport = await this.balances.balances(user.hotelId);
        if (balancesReport.rows.length > ROW_CAP) {
          throw new BadRequestException({ code: 'REPORT_EXPORT_ROW_LIMIT', message: 'Narrow the period', limit: ROW_CAP });
        }
        sheets = adapters.balancesSheets(balancesReport);
        break;
      }
      case 'leakage': {
        const leakageReport = await this.balances.leakage(user.hotelId, dto);
        if (leakageReport.rows.length > ROW_CAP) {
          throw new BadRequestException({ code: 'REPORT_EXPORT_ROW_LIMIT', message: 'Narrow the period', limit: ROW_CAP });
        }
        sheets = adapters.leakageSheets(leakageReport);
        break;
      }
    }
    const buffer = await this.xlsx.build(hotel, { from: resolved.fromDate, to: resolved.toDate }, new Date(), basisLine, sheets);
    return {
      buffer,
      filename: this.buildFilename(hotel.slug, report, resolved.fromDate, resolved.toDate, 'xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private basisLineFor(report: ReportName): string {
    switch (report) {
      case 'dining': return 'Basis: delivered orders only';
      case 'events': return 'Basis: events starting in this period';
      case 'totals': return 'Basis: delivered orders + booked events';
      default: return `Report: ${report}`;
    }
  }

  private async exportFeed(
    user: TenantUser,
    feed: FeedName,
    resolved: ReturnType<typeof resolvePeriod>,
    hotel: Hotel,
  ): Promise<ExportResult> {
    let headers: string[];
    let rows: (string | number)[][];
    switch (feed) {
      case 'stays-feed': {
        const stays = await this.staysRepo.find({
          where: { hotelId: user.hotelId, checkInDate: Between(resolved.fromDate, resolved.toDate) },
          take: 10001,
        });
        this.assertUnderCap(stays.length);
        headers = ['Room', 'Guest', 'Check-in', 'Check-out', 'Status', 'Stay type', 'Language', 'Guests'];
        rows = stays.map((s) => [s.roomId, s.guestName, s.checkInDate, s.checkOutDate, s.status, s.stayType, s.language, s.guestsCount ?? '']);
        break;
      }
      case 'requests-feed': {
        const requests = await this.requestsRepo.find({
          where: { hotelId: user.hotelId, createdAt: Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)) },
          take: 10001,
        });
        this.assertUnderCap(requests.length);
        headers = ['Room', 'Item', 'Status', 'Created', 'Completed', 'Cancelled reason'];
        // `createdAt` is a naive `timestamp` column (UTC wall time); pg
        // mis-parses it as host-local. fromNaive() recovers the true
        // instant (Epic 22 final review, C1) before it is rendered.
        rows = requests.map((r) => [r.roomNumber, r.itemNames.en ?? '', r.status, fromNaive(r.createdAt).toISOString(), r.completedAt?.toISOString() ?? '', r.cancelledReason ?? '']);
        break;
      }
      case 'orders-feed': {
        const orders = await this.ordersRepo.find({
          where: { hotelId: user.hotelId, createdAt: Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)) },
          take: 10001,
        });
        this.assertUnderCap(orders.length);
        headers = ['Room', 'Guest', 'Status', 'Payment', 'Total', 'Created', 'Delivered'];
        // `createdAt` is a naive `timestamp` column; fromNaive() recovers
        // the true instant (Epic 22 final review, C1) before rendering.
        rows = orders.map((o) => [o.roomNumber, o.guestName, o.status, o.paymentMethod ?? 'included', o.totalAmount, fromNaive(o.createdAt).toISOString(), o.deliveredAt?.toISOString() ?? '']);
        break;
      }
      case 'bookings-feed': {
        const bookings = await this.bookingsRepo.find({
          where: { hotelId: user.hotelId, createdAt: Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)) },
          take: 10001,
        });
        this.assertUnderCap(bookings.length);
        headers = ['Event', 'Party size', 'Status', 'Payment', 'Total', 'Created'];
        // `createdAt` is a naive `timestamp` column; fromNaive() recovers
        // the true instant (Epic 22 final review, C1) before rendering.
        rows = bookings.map((b) => [b.snapshot?.titles?.en ?? '', b.partySize, b.status, b.paymentMethod ?? 'included', b.totalAmount, fromNaive(b.createdAt).toISOString()]);
        break;
      }
    }
    const csv = toCsv(headers, rows);
    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: this.buildFilename(hotel.slug, feed, resolved.fromDate, resolved.toDate, 'csv'),
      contentType: 'text/csv; charset=utf-8',
    };
  }

  private assertUnderCap(count: number): void {
    if (count > ROW_CAP) {
      throw new BadRequestException({ code: 'REPORT_EXPORT_ROW_LIMIT', message: 'Narrow the period to export fewer rows', limit: ROW_CAP });
    }
  }
}
