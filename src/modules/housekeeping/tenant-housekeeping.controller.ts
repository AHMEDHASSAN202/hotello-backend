import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { AssignRoomDto } from './dto/assign-room.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { ClearRoomDto } from './dto/clear-room.dto';
import { FlagRoomDto } from './dto/flag-room.dto';
import { InterruptRoomDto } from './dto/interrupt-room.dto';
import { ListBoardQueryDto } from './dto/list-board-query.dto';
import { UpdateHousekeepingSettingsDto } from './dto/update-housekeeping-settings.dto';
import { HousekeepingService } from './housekeeping.service';

/**
 * Epic 20 — the housekeeping board + lifecycle. Endpoint-shaped so the Staff
 * Task PWA can consume the exact same actions later (note 7). Static routes
 * are declared above the parameterized tree (Nest matches in order).
 */
@TenantScope()
@RequireModule('housekeeping')
@Controller('tenant/housekeeping')
export class TenantHousekeepingController {
  constructor(private readonly housekeeping: HousekeepingService) {}

  @Get('board')
  @RequirePermissions('housekeeping.read')
  board(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListBoardQueryDto,
  ) {
    return this.housekeeping.listBoard(user, query);
  }

  @Get('assignees')
  @RequirePermissions('housekeeping.read')
  assignees(@CurrentTenantUser() user: TenantUser) {
    return this.housekeeping.listAssignees(user);
  }

  @Get('settings')
  @RequirePermissions('housekeeping.read')
  settings(@CurrentTenantUser() user: TenantUser) {
    return this.housekeeping.getSettings(user.hotelId);
  }

  @Patch('settings')
  @RequirePermissions('housekeeping.update')
  updateSettings(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpdateHousekeepingSettingsDto,
  ) {
    return this.housekeeping.updateSettings(user, dto);
  }

  @Post('assign-bulk')
  @HttpCode(200)
  @RequirePermissions('housekeeping.assign')
  bulkAssign(@CurrentTenantUser() user: TenantUser, @Body() dto: BulkAssignDto) {
    return this.housekeeping.bulkAssign(user, dto);
  }

  @Post('rooms/:id/flag')
  @HttpCode(200)
  @RequirePermissions('housekeeping.update')
  flag(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlagRoomDto,
  ) {
    return this.housekeeping.flagRoom(user, id, dto);
  }

  @Post('rooms/:id/clear')
  @HttpCode(200)
  @RequirePermissions('housekeeping.update')
  clear(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClearRoomDto,
  ) {
    return this.housekeeping.clearRoom(user, id, dto);
  }

  @Post('rooms/:id/start')
  @HttpCode(200)
  @RequirePermissions('housekeeping.update')
  start(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.housekeeping.start(user, id);
  }

  @Post('rooms/:id/complete')
  @HttpCode(200)
  @RequirePermissions('housekeeping.update')
  complete(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.housekeeping.complete(user, id);
  }

  @Post('rooms/:id/interrupt')
  @HttpCode(200)
  @RequirePermissions('housekeeping.update')
  interrupt(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InterruptRoomDto,
  ) {
    return this.housekeeping.interrupt(user, id, dto);
  }

  @Post('rooms/:id/assign')
  @HttpCode(200)
  @RequirePermissions('housekeeping.assign')
  assign(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoomDto,
  ) {
    return this.housekeeping.assign(user, id, dto);
  }
}
