import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateFnbItemDto, UpdateFnbItemDto } from './dto/fnb-item.dto';
import { CreateFnbMenuDto, UpdateFnbMenuDto } from './dto/fnb-menu.dto';
import { CreateFnbSectionDto, UpdateFnbSectionDto } from './dto/fnb-section.dto';
import { FnbPhotoService, FNB_PHOTO_MAX_BYTES } from './fnb-photo.service';
import { TenantFnbMenusService } from './tenant-fnb-menus.service';

/**
 * Epic 16, Story 16.2 — menu building. Own top-level prefix (not under
 * tenant/fnb-orders) so the board's `:id` wildcard can't swallow it. Static
 * segments (sections/items) are declared before `:id` routes — Nest matches
 * in declaration order.
 */
@TenantScope()
@RequireModule('fnb')
@Controller('tenant/fnb-menus')
export class TenantFnbMenusController {
  constructor(
    private readonly menus: TenantFnbMenusService,
    private readonly photos: FnbPhotoService,
  ) {}

  /**
   * Read gate is fnb_orders.read (not manage): the kitchen board's menu
   * filter needs menu names for every board user; building stays behind
   * fnb_menus.manage.
   */
  @Get()
  @RequirePermissions('fnb_orders.read')
  getTree(@CurrentTenantUser() user: TenantUser) {
    return this.menus.getTree(user);
  }

  @Patch('sections/:id')
  @RequirePermissions('fnb_menus.manage')
  updateSection(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFnbSectionDto,
  ) {
    return this.menus.updateSection(user, id, dto);
  }

  @Post('sections/:id/items')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fnb_menus.manage')
  createItem(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFnbItemDto,
  ) {
    return this.menus.createItem(user, id, dto);
  }

  @Patch('items/:id')
  @RequirePermissions('fnb_menus.manage')
  updateItem(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFnbItemDto,
  ) {
    return this.menus.updateItem(user, id, dto);
  }

  @Post('items/:id/photo')
  @HttpCode(200)
  @RequirePermissions('fnb_menus.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: FNB_PHOTO_MAX_BYTES } }),
  )
  setPhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.photos.setPhoto(user, id, file);
  }

  @Delete('items/:id/photo')
  @RequirePermissions('fnb_menus.manage')
  removePhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.photos.removePhoto(user, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fnb_menus.manage')
  createMenu(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateFnbMenuDto,
  ) {
    return this.menus.createMenu(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('fnb_menus.manage')
  updateMenu(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFnbMenuDto,
  ) {
    return this.menus.updateMenu(user, id, dto);
  }

  @Post(':id/sections')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fnb_menus.manage')
  createSection(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFnbSectionDto,
  ) {
    return this.menus.createSection(user, id, dto);
  }
}
