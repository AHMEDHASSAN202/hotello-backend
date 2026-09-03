import { Controller, Get, Query } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { ReportsBalancesService } from './reports-balances.service';

/**
 * Epic 22 — Reports & Analytics. Gated behind the `analytics` module (the
 * paid upsell); the rooms/stays list "has balance" badge (Task B2d) is
 * deliberately NOT gated the same way (recorded decision — see the epic
 * spec's Decisions section). This controller grows across Tasks B2c-B3d;
 * static routes are declared above any future parameterized route.
 */
@TenantScope()
@RequireModule('analytics')
@Controller('tenant/reports')
export class ReportsController {
  constructor(private readonly balances: ReportsBalancesService) {}

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
}
