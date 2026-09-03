import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventBooking } from '../events/event-booking.entity';
import { FnbOrder } from '../fnb/fnb-order.entity';
import { Hotel } from '../hotels/hotel.entity';
import { GuestRequest } from '../requests/request.entity';
import { naiveUtc } from '../tenant-stays/stay-time';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { resolvePeriod } from './reports-period';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsExportService } from './reports-export.service';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsOverviewService } from './reports-overview.service';
import { ReportsRevenueService } from './reports-revenue.service';
import { ReportsXlsxService } from './xlsx/reports-xlsx.service';

const HOTEL_ID = 'hotel-1';
// A fixed past custom range — fromDate/toDate/fromUtc/toUtcExclusive are then
// fully deterministic regardless of when this suite actually runs (no
// clamping to "today" kicks in for a past `to` date).
const CUSTOM_DTO: ReportPeriodDto = { preset: 'custom', from: '2026-03-01', to: '2026-03-01' } as ReportPeriodDto;

const makeHotel = (o: Partial<Hotel> = {}): Hotel =>
  ({
    id: HOTEL_ID,
    slug: 'acme',
    nameEn: 'Acme Hotel',
    nameAr: 'فندق أكمي',
    timezone: 'Africa/Cairo',
    ...o,
  }) as Hotel;

const makeUser = (permissions: string[] = ['*']): TenantUser =>
  ({ id: 'user-1', hotelId: HOTEL_ID, role: { permissions } }) as unknown as TenantUser;

describe('ReportsExportService (Story 22.5)', () => {
  let service: ReportsExportService;
  let hotelsRepo: { findOne: jest.Mock };
  let staysRepo: { find: jest.Mock };
  let requestsRepo: { find: jest.Mock };
  let ordersRepo: { find: jest.Mock };
  let bookingsRepo: { find: jest.Mock };
  let xlsx: { build: jest.Mock };
  let balances: { balances: jest.Mock; leakage: jest.Mock };
  let operational: { guests: jest.Mock; requests: jest.Mock; housekeeping: jest.Mock };
  let revenue: { dining: jest.Mock; events: jest.Mock; totals: jest.Mock };
  let overview: { overview: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    requestsRepo = { find: jest.fn().mockResolvedValue([]) };
    ordersRepo = { find: jest.fn().mockResolvedValue([]) };
    bookingsRepo = { find: jest.fn().mockResolvedValue([]) };
    xlsx = { build: jest.fn().mockResolvedValue(Buffer.from('xlsx-bytes')) };
    balances = {
      balances: jest.fn().mockResolvedValue({ rows: [] }),
      leakage: jest.fn().mockResolvedValue({ rows: [] }),
    };
    operational = {
      guests: jest.fn().mockResolvedValue({ occupancyTrend: [] }),
      requests: jest.fn().mockResolvedValue({ volumeByDay: [], byCategory: [], byItem: [] }),
      housekeeping: jest.fn().mockResolvedValue({ cleanedByDay: [], attendants: [] }),
    };
    revenue = {
      dining: jest.fn().mockResolvedValue({ revenueByDay: [], topItems: [], byZone: [] }),
      events: jest.fn().mockResolvedValue({ events: [] }),
      totals: jest.fn().mockResolvedValue({ byDay: [] }),
    };
    overview = {
      overview: jest.fn().mockResolvedValue({
        occupancy: { occupiedNow: 0, totalRooms: 0, pct: 0, arrivalsToday: 0, departuresToday: 0, inHouseGuests: 0 },
        service: { received: { value: 0 }, completed: { value: 0 }, openNow: 0, avgCompletionMinutes: { value: 0 }, slaBreachRatePct: { value: 0 } },
        housekeeping: { cleanedToday: 0, needingCleaning: 0, inProgress: 0, dnd: 0 },
      }),
    };
    auditLogs = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsExportService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(GuestRequest), useValue: requestsRepo },
        { provide: getRepositoryToken(FnbOrder), useValue: ordersRepo },
        { provide: getRepositoryToken(EventBooking), useValue: bookingsRepo },
        { provide: ReportsXlsxService, useValue: xlsx },
        { provide: ReportsBalancesService, useValue: balances },
        { provide: ReportsOperationalService, useValue: operational },
        { provide: ReportsRevenueService, useValue: revenue },
        { provide: ReportsOverviewService, useValue: overview },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(ReportsExportService);
  });

  it('1. throws NotFoundException with code REPORT_NOT_FOUND for an unknown :report value', async () => {
    await expect(service.export(makeUser(), 'not-a-report', CUSTOM_DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    try {
      await service.export(makeUser(), 'not-a-report', CUSTOM_DTO);
      fail('expected NotFoundException');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'REPORT_NOT_FOUND' });
    }
  });

  it('2. a revenue-classified report (dining) for a non-revenue user throws ForbiddenException(REPORTS_REVENUE_FORBIDDEN) BEFORE any data fetch', async () => {
    const nonRevenueUser = makeUser(['reports.read']);

    try {
      await service.export(nonRevenueUser, 'dining', CUSTOM_DTO);
      fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'REPORTS_REVENUE_FORBIDDEN' });
    }

    expect(revenue.dining).not.toHaveBeenCalled();
    expect(hotelsRepo.findOne).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  describe('3. row-cap on balances/leakage', () => {
    it('balances throws REPORT_EXPORT_ROW_LIMIT when rows.length exceeds 10,000', async () => {
      balances.balances.mockResolvedValue({ rows: new Array(10001).fill({}) });

      try {
        await service.export(makeUser(), 'balances', CUSTOM_DTO);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'REPORT_EXPORT_ROW_LIMIT' });
      }
    });

    it('leakage throws REPORT_EXPORT_ROW_LIMIT when rows.length exceeds 10,000', async () => {
      balances.leakage.mockResolvedValue({ rows: new Array(10001).fill({}) });

      try {
        await service.export(makeUser(), 'leakage', CUSTOM_DTO);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'REPORT_EXPORT_ROW_LIMIT' });
      }
    });
  });

  describe('4. row-cap on the 4 CSV feeds', () => {
    it.each([
      ['stays-feed', () => staysRepo],
      ['requests-feed', () => requestsRepo],
      ['orders-feed', () => ordersRepo],
      ['bookings-feed', () => bookingsRepo],
    ])('%s throws REPORT_EXPORT_ROW_LIMIT when its repo returns 10,001 rows', async (feed, getRepo) => {
      getRepo().find.mockResolvedValue(new Array(10001).fill({}));

      try {
        await service.export(makeUser(), feed, CUSTOM_DTO);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'REPORT_EXPORT_ROW_LIMIT' });
      }
    });
  });

  describe('5. filename format {hotel-slug}-{report}-{from}-{to}.{ext}', () => {
    it('an xlsx report (overview) gets the .xlsx extension and correct name', async () => {
      const result = await service.export(makeUser(), 'overview', CUSTOM_DTO);

      expect(result.filename).toBe('acme-overview-2026-03-01-2026-03-01.xlsx');
      expect(result.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('a csv feed (stays-feed) gets the .csv extension and correct name', async () => {
      const result = await service.export(makeUser(), 'stays-feed', CUSTOM_DTO);

      expect(result.filename).toBe('acme-stays-feed-2026-03-01-2026-03-01.csv');
      expect(result.contentType).toBe('text/csv; charset=utf-8');
    });
  });

  describe('6. report.exported audit logging', () => {
    it('logs AFTER a successful export with report/format/from/to/hotelId/actorType', async () => {
      await service.export(makeUser(), 'overview', CUSTOM_DTO);

      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'report.exported',
          entityType: 'report',
          entityId: HOTEL_ID,
          actorId: 'user-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: HOTEL_ID,
            report: 'overview',
            format: 'xlsx',
            from: '2026-03-01',
            to: '2026-03-01',
          }),
        }),
      );
    });

    it('logs format "csv" for a feed export', async () => {
      await service.export(makeUser(), 'stays-feed', CUSTOM_DTO);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ format: 'csv' }) }),
      );
    });

    it('does NOT log when a 403 was thrown before reaching that point', async () => {
      await expect(service.export(makeUser(['reports.read']), 'dining', CUSTOM_DTO)).rejects.toThrow();

      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('does NOT log when a 404 (unknown report) was thrown before reaching that point', async () => {
      await expect(service.export(makeUser(), 'not-a-report', CUSTOM_DTO)).rejects.toThrow();

      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('does NOT log when a 400 (row cap) was thrown before reaching that point', async () => {
      balances.balances.mockResolvedValue({ rows: new Array(10001).fill({}) });

      await expect(service.export(makeUser(), 'balances', CUSTOM_DTO)).rejects.toThrow();

      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

  it('7. maps a ReportPeriodError to BadRequestException with the error\'s own code', async () => {
    const invalidDto = { preset: 'custom' } as ReportPeriodDto; // missing from/to

    try {
      await service.export(makeUser(), 'overview', invalidDto);
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'REPORT_RANGE_INVALID' });
    }
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  describe('8. feeds query the right date field with the right wrapping', () => {
    const resolved = resolvePeriod('Africa/Cairo', new Date(), CUSTOM_DTO);

    it('stays-feed uses checkInDate with a plain date-string Between (no naiveUtc)', async () => {
      await service.export(makeUser(), 'stays-feed', CUSTOM_DTO);

      expect(staysRepo.find).toHaveBeenCalledTimes(1);
      const callArg = staysRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.checkInDate).toEqual(Between(resolved.fromDate, resolved.toDate));
    });

    it('requests-feed uses createdAt wrapped in naiveUtc', async () => {
      await service.export(makeUser(), 'requests-feed', CUSTOM_DTO);

      expect(requestsRepo.find).toHaveBeenCalledTimes(1);
      const callArg = requestsRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.createdAt).toEqual(
        Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)),
      );
    });

    it('orders-feed uses createdAt wrapped in naiveUtc', async () => {
      await service.export(makeUser(), 'orders-feed', CUSTOM_DTO);

      expect(ordersRepo.find).toHaveBeenCalledTimes(1);
      const callArg = ordersRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.createdAt).toEqual(
        Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)),
      );
    });

    it('bookings-feed uses createdAt wrapped in naiveUtc', async () => {
      await service.export(makeUser(), 'bookings-feed', CUSTOM_DTO);

      expect(bookingsRepo.find).toHaveBeenCalledTimes(1);
      const callArg = bookingsRepo.find.mock.calls[0][0];
      expect(callArg.where.hotelId).toBe(HOTEL_ID);
      expect(callArg.where.createdAt).toEqual(
        Between(naiveUtc(resolved.fromUtc), naiveUtc(resolved.toUtcExclusive)),
      );
    });
  });
});
