import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { StaySettlementService } from '../stay-settlement/stay-settlement.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ChangeRoomDto } from './dto/change-room.dto';
import { CreateStayDto } from './dto/create-stay.dto';
import { ListStaysQueryDto } from './dto/list-stays-query.dto';
import { UpdateStayDto } from './dto/update-stay.dto';
import { UpdateStaySettingsDto } from './dto/update-stay-settings.dto';
import { TenantStaysService } from './tenant-stays.service';

/**
 * Stays (Epic 13). `hotel_id` always comes from the authenticated tenant
 * user, never the client. Static routes declared before `:id`.
 */
@TenantScope()
@Controller('tenant/stays')
export class TenantStaysController {
  constructor(
    private readonly staysService: TenantStaysService,
    private readonly staySettlement: StaySettlementService,
  ) {}

  @Get()
  @RequirePermissions('stays.read')
  async list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListStaysQueryDto,
  ) {
    // Story 22.4 AC4 — fetched unconditionally on every list call (not only
    // when hasBalance is requested): the balance decoration must appear on
    // any row that has one, independent of whether the filter is active.
    const balances = await this.staySettlement.unsettledByStay(user.hotelId);
    return this.staysService.list(user, query, balances);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('stays.checkin')
  checkIn(@CurrentTenantUser() user: TenantUser, @Body() dto: CreateStayDto) {
    return this.staysService.checkIn(user, dto);
  }

  @Get('available-rooms')
  @RequirePermissions('stays.read')
  availableRooms(@CurrentTenantUser() user: TenantUser) {
    return this.staysService.availableRooms(user);
  }

  @Get('settings')
  @RequirePermissions('stays.read')
  getSettings(@CurrentTenantUser() user: TenantUser) {
    return this.staysService.getSettings(user.hotelId);
  }

  @Patch('settings')
  @RequirePermissions('stays.update')
  updateSettings(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpdateStaySettingsDto,
  ) {
    return this.staysService.updateSettings(user, dto);
  }

  @Get(':id')
  @RequirePermissions('stays.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staysService.detail(user, id);
  }

  @Patch(':id')
  @RequirePermissions('stays.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStayDto,
  ) {
    return this.staysService.update(user, id, dto);
  }

  @Post(':id/change-room')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('stays.update')
  changeRoom(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoomDto,
  ) {
    return this.staysService.changeRoom(user, id, dto);
  }

  @Post(':id/regenerate-code')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('stays.update')
  regenerateCode(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staysService.regenerateCode(user, id);
  }

  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('stays.checkout')
  checkout(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staysService.checkout(user, id);
  }
}
