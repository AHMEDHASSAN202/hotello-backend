import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsExportService } from './reports-export.service';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsOverviewService } from './reports-overview.service';
import { ReportsRevenueService } from './reports-revenue.service';
import { ReportsController } from './reports.controller';

const user = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

const wildcardUser = { id: 'user-2', hotelId: 'hotel-1', role: { permissions: ['*'] } } as unknown as TenantUser;

const reportsReadOnlyUser = {
  id: 'user-3',
  hotelId: 'hotel-1',
  role: { permissions: ['reports.read'] },
} as unknown as TenantUser;

describe('ReportsController (Story 22.4)', () => {
  let controller: ReportsController;
  let balances: { balances: jest.Mock; leakage: jest.Mock };
  let operational: { guests: jest.Mock; requests: jest.Mock; housekeeping: jest.Mock };
  let revenue: { dining: jest.Mock; events: jest.Mock; totals: jest.Mock };
  let overview: { overview: jest.Mock };
  let exportService: { export: jest.Mock };

  beforeEach(async () => {
    balances = { balances: jest.fn(), leakage: jest.fn() };
    operational = { guests: jest.fn(), requests: jest.fn(), housekeeping: jest.fn() };
    revenue = { dining: jest.fn(), events: jest.fn(), totals: jest.fn() };
    overview = { overview: jest.fn() };
    exportService = { export: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsBalancesService, useValue: balances },
        { provide: ReportsOperationalService, useValue: operational },
        { provide: ReportsRevenueService, useValue: revenue },
        { provide: ReportsOverviewService, useValue: overview },
        { provide: ReportsExportService, useValue: exportService },
      ],
    }).compile();
    controller = moduleRef.get(ReportsController);
  });

  it('1. GET balances calls balances.balances(user.hotelId)', () => {
    controller.getBalances(user);

    expect(balances.balances).toHaveBeenCalledWith('hotel-1');
  });

  it('2. GET balances/leakage calls balances.leakage(user.hotelId, query) unchanged', () => {
    const query: ReportPeriodDto = { preset: 'last7' } as ReportPeriodDto;

    controller.getLeakage(user, query);

    expect(balances.leakage).toHaveBeenCalledWith('hotel-1', query);
  });
});

describe('ReportsController — Tasks B3a-d endpoints (Story 22.6 AC2)', () => {
  let controller: ReportsController;
  let balances: { balances: jest.Mock; leakage: jest.Mock };
  let operational: { guests: jest.Mock; requests: jest.Mock; housekeeping: jest.Mock };
  let revenue: { dining: jest.Mock; events: jest.Mock; totals: jest.Mock };
  let overview: { overview: jest.Mock };
  let exportService: { export: jest.Mock };
  const query: ReportPeriodDto = { preset: 'last7' } as ReportPeriodDto;

  beforeEach(async () => {
    balances = { balances: jest.fn(), leakage: jest.fn() };
    operational = { guests: jest.fn(), requests: jest.fn(), housekeeping: jest.fn() };
    revenue = { dining: jest.fn(), events: jest.fn(), totals: jest.fn() };
    overview = { overview: jest.fn() };
    exportService = { export: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsBalancesService, useValue: balances },
        { provide: ReportsOperationalService, useValue: operational },
        { provide: ReportsRevenueService, useValue: revenue },
        { provide: ReportsOverviewService, useValue: overview },
        { provide: ReportsExportService, useValue: exportService },
      ],
    }).compile();
    controller = moduleRef.get(ReportsController);
  });

  describe('getOverview', () => {
    it('passes includeRevenue=true for a wildcard (*) user', () => {
      controller.getOverview(wildcardUser, query);

      expect(overview.overview).toHaveBeenCalledWith('hotel-1', query, true);
    });

    it('passes includeRevenue=false for a reports.read-only user (no reports.revenue)', () => {
      controller.getOverview(reportsReadOnlyUser, query);

      expect(overview.overview).toHaveBeenCalledWith('hotel-1', query, false);
    });
  });

  describe('operational endpoints', () => {
    it('getGuests calls operational.guests(user.hotelId, query)', () => {
      controller.getGuests(user, query);

      expect(operational.guests).toHaveBeenCalledWith('hotel-1', query);
    });

    it('getRequests calls operational.requests(user.hotelId, query)', () => {
      controller.getRequests(user, query);

      expect(operational.requests).toHaveBeenCalledWith('hotel-1', query);
    });

    it('getHousekeeping calls operational.housekeeping(user.hotelId, query)', () => {
      controller.getHousekeeping(user, query);

      expect(operational.housekeeping).toHaveBeenCalledWith('hotel-1', query);
    });
  });

  describe('revenue endpoints — granted access', () => {
    it('getDining calls revenue.dining(user.hotelId, query) for a wildcard user', () => {
      controller.getDining(wildcardUser, query);

      expect(revenue.dining).toHaveBeenCalledWith('hotel-1', query);
    });

    it('getEvents calls revenue.events(user.hotelId, query) for a wildcard user', () => {
      controller.getEvents(wildcardUser, query);

      expect(revenue.events).toHaveBeenCalledWith('hotel-1', query);
    });

    it('getTotals calls revenue.totals(user.hotelId, query) for a wildcard user', () => {
      controller.getTotals(wildcardUser, query);

      expect(revenue.totals).toHaveBeenCalledWith('hotel-1', query);
    });
  });

  describe('revenue endpoints — Front Desk (reports.read but no reports.revenue) is forbidden', () => {
    it('getDining throws ForbiddenException with code REPORTS_REVENUE_FORBIDDEN and never calls revenue.dining', () => {
      expect(() => controller.getDining(reportsReadOnlyUser, query)).toThrow(ForbiddenException);
      try {
        controller.getDining(reportsReadOnlyUser, query);
        fail('expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'REPORTS_REVENUE_FORBIDDEN' });
      }
      expect(revenue.dining).not.toHaveBeenCalled();
    });

    it.each([
      ['getEvents', () => controller.getEvents(reportsReadOnlyUser, query), () => revenue.events],
      ['getTotals', () => controller.getTotals(reportsReadOnlyUser, query), () => revenue.totals],
    ])('%s throws ForbiddenException with code REPORTS_REVENUE_FORBIDDEN and never calls the underlying service', (_name, call, getMock) => {
      try {
        call();
        fail('expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'REPORTS_REVENUE_FORBIDDEN' });
      }
      expect(getMock()).not.toHaveBeenCalled();
    });
  });
});

describe('ReportsController — export route (Story 22.5)', () => {
  let controller: ReportsController;
  let exportService: { export: jest.Mock };
  const query: ReportPeriodDto = { preset: 'last7' } as ReportPeriodDto;

  beforeEach(async () => {
    exportService = { export: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsBalancesService, useValue: { balances: jest.fn(), leakage: jest.fn() } },
        { provide: ReportsOperationalService, useValue: { guests: jest.fn(), requests: jest.fn(), housekeeping: jest.fn() } },
        { provide: ReportsRevenueService, useValue: { dining: jest.fn(), events: jest.fn(), totals: jest.fn() } },
        { provide: ReportsOverviewService, useValue: { overview: jest.fn() } },
        { provide: ReportsExportService, useValue: exportService },
      ],
    }).compile();
    controller = moduleRef.get(ReportsController);
  });

  it('GET :report/export calls exportService.export(user, report, query) and writes the buffer/headers to the response', async () => {
    const buffer = Buffer.from('xlsx-bytes');
    exportService.export.mockResolvedValue({
      buffer,
      filename: 'acme-overview-2026-03-01-2026-03-07.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const res = { setHeader: jest.fn(), send: jest.fn() };

    await controller.exportReport(user, 'overview', query, res as any);

    expect(exportService.export).toHaveBeenCalledWith(user, 'overview', query);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="acme-overview-2026-03-01-2026-03-07.xlsx"',
    );
    expect(res.send).toHaveBeenCalledWith(buffer);
  });
});
