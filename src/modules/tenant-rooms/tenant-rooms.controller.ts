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
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BulkCommitDto } from './dto/bulk-commit.dto';
import { BulkPreviewDto } from './dto/bulk-preview.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('rooms.create')
  async create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateRoomDto,
  ) {
    const room = await this.roomsService.createRoom(user, dto);
    return this.roomsService.toRoomView(room);
  }

  // NOTE: later tasks add more static routes here (qr/general, pdf/*,
  // export, import/*) — every static route MUST be declared above `:id`,
  // since Nest matches routes in declaration order and `:id` would
  // otherwise swallow them.
  @Post('bulk/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rooms.create')
  bulkPreview(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: BulkPreviewDto,
  ) {
    return this.roomsService.bulkPreview(user, dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('rooms.create')
  bulkCommit(@CurrentTenantUser() user: TenantUser, @Body() dto: BulkCommitDto) {
    return this.roomsService.bulkCommit(user, dto);
  }

  @Get(':id')
  @RequirePermissions('rooms.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.detail(user.hotelId, id);
  }

  @Patch(':id')
  @RequirePermissions('rooms.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.updateRoom(user, id, dto);
  }
}
