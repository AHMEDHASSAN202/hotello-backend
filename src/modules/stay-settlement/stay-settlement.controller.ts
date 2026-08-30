import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { StaySettlementService } from './stay-settlement.service';

/**
 * Story 21.6 AC2 — the combined checkout total/settle surface. Guarded by
 * `stays.checkout`, not a per-module read permission: this is a front-desk
 * checkout action, and a front-desk user shouldn't need `fnb_orders.read` +
 * `events.read` just to see the combined unsettled total (the F&B
 * settlement route's own guarding precedent).
 */
@TenantScope()
@Controller('tenant/stays')
export class StaySettlementController {
  constructor(private readonly settlement: StaySettlementService) {}

  @Get(':stayId/unsettled')
  @RequirePermissions('stays.checkout')
  unsettledTotal(
    @CurrentTenantUser() user: TenantUser,
    @Param('stayId', ParseUUIDPipe) stayId: string,
  ) {
    return this.settlement.unsettledTotal(user, stayId);
  }

  @Post(':stayId/settle')
  @HttpCode(200)
  @RequirePermissions('stays.checkout')
  settle(
    @CurrentTenantUser() user: TenantUser,
    @Param('stayId', ParseUUIDPipe) stayId: string,
  ) {
    return this.settlement.settle(user, stayId);
  }
}
