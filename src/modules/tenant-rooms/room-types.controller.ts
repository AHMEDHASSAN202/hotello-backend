import {
  Body,
  Controller,
  Get,
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
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { RoomTypesService } from './room-types.service';

/**
 * Room Types CRUD-lite (Epic 11, Story 11.1). Path is deliberately
 * `tenant/room-types`, not nested under `tenant/rooms`, so it never collides
 * with the `tenant/rooms/:id` wildcard route (Story 11.4). `hotel_id` always
 * comes from the authenticated tenant user, never the client.
 */
@TenantScope()
@Controller('tenant/room-types')
export class RoomTypesController {
  constructor(private readonly roomTypesService: RoomTypesService) {}

  @Get()
  @RequirePermissions('rooms.read')
  async list(
    @CurrentTenantUser() user: TenantUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const types = await this.roomTypesService.listTypes(
      user.hotelId,
      includeInactive === '1',
    );
    return {
      data: types.map((type) => ({
        id: type.id,
        nameEn: type.nameEn,
        nameAr: type.nameAr,
        descriptionEn: type.descriptionEn,
        descriptionAr: type.descriptionAr,
        isActive: type.isActive,
        roomsCount: type.roomsCount,
      })),
    };
  }

  @Post()
  @RequirePermissions('rooms.update')
  create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateRoomTypeDto,
  ) {
    return this.roomTypesService.createType(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('rooms.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomTypeDto,
  ) {
    return this.roomTypesService.updateType(user, id, dto);
  }
}
