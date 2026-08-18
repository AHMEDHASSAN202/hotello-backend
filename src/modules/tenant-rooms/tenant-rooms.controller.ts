import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { TenantRoomsService } from './tenant-rooms.service';

/**
 * Rooms (Epic 11, Story 11.2+). `hotel_id` always comes from the
 * authenticated tenant user, never the client. Registered after
 * `RoomTypesController` in the module so `tenant/room-types` never falls
 * through this controller's `:id` wildcard.
 */
@TenantScope()
@Controller('tenant/rooms')
export class TenantRoomsController {
  constructor(private readonly roomsService: TenantRoomsService) {}

  @Get()
  @RequirePermissions('rooms.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListRoomsQueryDto,
  ) {
    return this.roomsService.list(user.hotelId, query);
  }

  // NOTE: later tasks add static routes here (bulk/*, qr/general, pdf/*,
  // export, import/*) — every static route MUST be declared above `:id`,
  // since Nest matches routes in declaration order and `:id` would
  // otherwise swallow them.
  @Get(':id')
  @RequirePermissions('rooms.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.detail(user.hotelId, id);
  }
}
