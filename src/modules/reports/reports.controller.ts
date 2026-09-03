import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { canReadRevenue } from './reports-access';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsOperationalService } from './reports-operational.service';
import { ReportsOverviewService } from './reports-overview.service';
import { ReportsRevenueService } from './reports-revenue.service';

/**
 * Epic 22 — Reports & Analytics. Gated behind the `analytics` module (the
 * paid upsell); the rooms/stays list "has balance" badge (Task B2d) is
 * deliberately NOT gated the same way (recorded decision — see the epic
 * spec's Decisions section). Revenue reports (`dining`/`events`/`totals`)
 * additionally require `reports.revenue` (Story 22.6 AC2) — checked here,
 * not as a route decorator, since it's a full-response block (unlike
 * `overview`, which needs partial content and does its own service-layer
 * check). Static routes only — no `:id` parameter anywhere in this
 * controller, so declaration order doesn't matter for routing, but keep the
 * existing `balances`/`balances/leakage` routes first since they were here
 * first (Task B2c).
 */
@TenantScope()
@RequireModule('analytics')
@Controller('tenant/reports')
export class ReportsController {
  constructor(
    private readonly balances: ReportsBalancesService,
    private readonly operational: ReportsOperationalService,
    private readonly revenue: ReportsRevenueService,
    private readonly overview: ReportsOverviewService,
  ) {}

  @Get('balances')
  @RequirePermissions('reports.read')
  getBalances(@CurrentTenantUser() user: TenantUser) {
    return this.balances.balances(user.hotelId);
  }

  @Get('balances/leakage')
  @RequirePermissions('reports.read')
  getLeakage(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    return this.balances.leakage(user.hotelId, query);
  }

  @Get('overview')
  @RequirePermissions('reports.read')
  getOverview(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    return this.overview.overview(user.hotelId, query, canReadRevenue(user));
  }

  @Get('guests')
  @RequirePermissions('reports.read')
  getGuests(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    return this.operational.guests(user.hotelId, query);
  }

  @Get('requests')
  @RequirePermissions('reports.read')
  getRequests(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    return this.operational.requests(user.hotelId, query);
  }

  @Get('housekeeping')
  @RequirePermissions('reports.read')
  getHousekeeping(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    return this.operational.housekeeping(user.hotelId, query);
  }

  @Get('dining')
  @RequirePermissions('reports.read')
  getDining(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    this.assertRevenueAccess(user);
    return this.revenue.dining(user.hotelId, query);
  }

  @Get('events')
  @RequirePermissions('reports.read')
  getEvents(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    this.assertRevenueAccess(user);
    return this.revenue.events(user.hotelId, query);
  }

  @Get('totals')
  @RequirePermissions('reports.read')
  getTotals(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ReportPeriodDto,
  ) {
    this.assertRevenueAccess(user);
    return this.revenue.totals(user.hotelId, query);
  }

  private assertRevenueAccess(user: TenantUser): void {
    if (!canReadRevenue(user)) {
      throw new ForbiddenException({
        code: 'REPORTS_REVENUE_FORBIDDEN',
        message: 'This report requires revenue access',
      });
    }
  }
}
