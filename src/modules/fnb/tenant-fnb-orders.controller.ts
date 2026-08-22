import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  AssignFnbOrderDto,
  CancelFnbOrderDto,
  ListTenantFnbOrdersQueryDto,
  SettleFnbOrdersDto,
} from './dto/tenant-fnb-orders.dto';
import { TenantFnbOrdersService } from './tenant-fnb-orders.service';

/**
 * Epic 16, Stories 16.7/16.8 — kitchen board, lifecycle, assignment, and
 * room-charge settlement. Static routes above `:id` (Nest matches in
 * declaration order). Settlement is guarded by stays.checkout — it's a
 * front-desk checkout action, not a kitchen one (recorded decision; the
 * seeded Front Desk role has no fnb_orders.update).
 */
@TenantScope()
@RequireModule('fnb')
@Controller('tenant/fnb-orders')
export class TenantFnbOrdersController {
  constructor(private readonly orders: TenantFnbOrdersService) {}

  @Get()
  @RequirePermissions('fnb_orders.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListTenantFnbOrdersQueryDto,
  ) {
    return this.orders.list(user, query);
  }

  @Get('assignees')
  @RequirePermissions('fnb_orders.read')
  listAssignees(@CurrentTenantUser() user: TenantUser) {
    return this.orders.listAssignees(user);
  }

  @Get('stay/:stayId')
  @RequirePermissions('fnb_orders.read')
  stayOrders(
    @CurrentTenantUser() user: TenantUser,
    @Param('stayId', ParseUUIDPipe) stayId: string,
  ) {
    return this.orders.stayOrders(user, stayId);
  }

  @Post('stay/:stayId/settle')
  @HttpCode(200)
  @RequirePermissions('stays.checkout')
  settle(
    @CurrentTenantUser() user: TenantUser,
    @Param('stayId', ParseUUIDPipe) stayId: string,
    @Body() dto: SettleFnbOrdersDto,
  ) {
    return this.orders.settleStayOrders(user, stayId, dto);
  }

  @Get(':id')
  @RequirePermissions('fnb_orders.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.getDetail(user, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('fnb_orders.update')
  start(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.start(user, id);
  }

  @Post(':id/out-for-delivery')
  @HttpCode(200)
  @RequirePermissions('fnb_orders.update')
  outForDelivery(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.outForDelivery(user, id);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermissions('fnb_orders.update')
  deliver(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.deliver(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('fnb_orders.update')
  cancel(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFnbOrderDto,
  ) {
    return this.orders.cancel(user, id, dto);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('fnb_orders.update')
  assign(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignFnbOrderDto,
  ) {
    return this.orders.assign(user, id, dto);
  }
}
