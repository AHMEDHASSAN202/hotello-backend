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
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateCustomItemDto } from './dto/create-custom-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { TenantRequestCatalogService } from './tenant-request-catalog.service';

export class SetCategoryEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

/**
 * Epic 15, Story 15.1 — catalog curation. Own top-level prefix (not under
 * tenant/requests) so the board's `:id` wildcard can't swallow it.
 */
@TenantScope()
@RequireModule('requests')
@Controller('tenant/request-catalog')
export class TenantRequestCatalogController {
  constructor(private readonly catalog: TenantRequestCatalogService) {}

  /**
   * Read gate is requests.read (not manage): the board's category filter
   * needs category/item names for every board user; curation stays behind
   * request_catalog.manage.
   */
  @Get()
  @RequirePermissions('requests.read')
  getCatalog(@CurrentTenantUser() user: TenantUser) {
    return this.catalog.getCatalog(user);
  }

  @Patch('categories/:id')
  @RequirePermissions('request_catalog.manage')
  setCategoryEnabled(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryEnabledDto,
  ) {
    return this.catalog.setCategoryEnabled(user, id, dto.enabled);
  }

  @Post('categories/:id/reorder')
  @HttpCode(200)
  @RequirePermissions('request_catalog.manage')
  reorder(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderItemsDto,
  ) {
    return this.catalog.reorderItems(user, id, dto);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('request_catalog.manage')
  createCustomItem(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateCustomItemDto,
  ) {
    return this.catalog.createCustomItem(user, dto);
  }

  @Patch('items/:id')
  @RequirePermissions('request_catalog.manage')
  updateItem(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalog.updateItem(user, id, dto);
  }
}
