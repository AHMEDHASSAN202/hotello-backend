import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  CreateInfoEntryDto,
  ReorderInfoEntriesDto,
  UpdateInfoEntryDto,
  UpsertAboutDto,
  UpsertEssentialsDto,
} from './dto/hotel-info.dto';
import {
  HotelInfoSection,
  REPEATABLE_SECTIONS,
} from './hotel-info.constants';
import { TenantHotelInfoService } from './tenant-hotel-info.service';

/**
 * Epic 17, Story 17.1 — directory management. One permission gates the
 * whole page (spec header); static segments before `:id` routes (Nest
 * matches in declaration order).
 */
@TenantScope()
@RequireModule('hotel_info')
@Controller('tenant/hotel-info')
export class TenantHotelInfoController {
  constructor(private readonly info: TenantHotelInfoService) {}

  @Get()
  @RequirePermissions('hotel_info.manage')
  getOverview(@CurrentTenantUser() user: TenantUser) {
    return this.info.getOverview(user);
  }

  @Put('essentials')
  @RequirePermissions('hotel_info.manage')
  upsertEssentials(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpsertEssentialsDto,
  ) {
    return this.info.upsertEssentials(user, dto);
  }

  @Put('about')
  @RequirePermissions('hotel_info.manage')
  upsertAbout(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpsertAboutDto,
  ) {
    return this.info.upsertAbout(user, dto);
  }

  @Post('entries')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('hotel_info.manage')
  createEntry(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateInfoEntryDto,
  ) {
    return this.info.createEntry(user, dto);
  }

  @Patch('entries/:id')
  @RequirePermissions('hotel_info.manage')
  updateEntry(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInfoEntryDto,
  ) {
    return this.info.updateEntry(user, id, dto);
  }

  @Post('sections/:section/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hotel_info.manage')
  reorder(
    @CurrentTenantUser() user: TenantUser,
    @Param('section') section: string,
    @Body() dto: ReorderInfoEntriesDto,
  ) {
    if (!REPEATABLE_SECTIONS.includes(section as HotelInfoSection)) {
      throw new NotFoundException({
        code: 'HOTEL_INFO_SECTION_NOT_FOUND',
        message: 'Unknown section',
      });
    }
    return this.info.reorder(user, section as HotelInfoSection, dto);
  }
}
