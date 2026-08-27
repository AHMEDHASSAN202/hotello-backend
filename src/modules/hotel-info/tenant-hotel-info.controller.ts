import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  HOTEL_INFO_PHOTO_MAX_BYTES,
  HotelInfoSection,
  REPEATABLE_SECTIONS,
} from './hotel-info.constants';
import { HotelInfoPhotoService } from './hotel-info-photo.service';
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
  constructor(
    private readonly info: TenantHotelInfoService,
    private readonly photos: HotelInfoPhotoService,
  ) {}

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

  @Post('entries/:id/photos')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hotel_info.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: HOTEL_INFO_PHOTO_MAX_BYTES },
    }),
  )
  addPhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.photos.addPhoto(user, id, file);
  }

  @Delete('entries/:id/photos/:photoId')
  @RequirePermissions('hotel_info.manage')
  removePhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.photos.removePhoto(user, id, photoId);
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
