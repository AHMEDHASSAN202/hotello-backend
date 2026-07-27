import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Admin } from '../admins/admin.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { ListHotelsQueryDto } from './dto/list-hotels-query.dto';
import { OnboardHotelDto } from './dto/onboard-hotel.dto';
import { SuspendHotelDto } from './dto/suspend-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelOnboardingService } from './hotel-onboarding.service';
import { LOGO_MAX_BYTES } from './hotels.constants';
import { HotelsService } from './hotels.service';

/**
 * No DELETE route by design (Story 5.5 AC6) — permanent offboarding is a
 * future epic. Static paths are declared before ':id' so they never shadow.
 */
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly onboardingService: HotelOnboardingService,
    private readonly tenantUsersService: TenantUsersService,
  ) {}

  @Get()
  @RequirePermissions('hotels.read')
  findAll(@Query() query: ListHotelsQueryDto) {
    return this.hotelsService.findAll(query);
  }

  @Get('slug-availability')
  @RequirePermissions('hotels.create')
  checkSlug(@Query('slug') slug: string) {
    return this.hotelsService.checkSlug(slug ?? '');
  }

  @Post()
  @RequirePermissions('hotels.create')
  onboard(@Body() dto: OnboardHotelDto, @CurrentAdmin() actor: Admin) {
    return this.onboardingService.onboard(dto, actor);
  }

  @Get(':id')
  @RequirePermissions('hotels.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotelsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('hotels.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.hotelsService.update(id, dto, actor);
  }

  @Patch(':id/suspend')
  @RequirePermissions('hotels.suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendHotelDto,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.hotelsService.suspend(id, dto, actor);
  }

  @Patch(':id/reactivate')
  @RequirePermissions('hotels.suspend')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.hotelsService.reactivate(id, actor);
  }

  @Post(':id/logo')
  @RequirePermissions('hotels.update')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES } }),
  )
  uploadLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.hotelsService.uploadLogo(id, file, actor);
  }

  /** POST (not PATCH): mints a new secret; invalidates the previous link. */
  @Post(':id/owner/regenerate-setup-link')
  @RequirePermissions('hotels.update')
  regenerateSetupLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.tenantUsersService.regenerateSetupLink(id, actor);
  }
}
