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
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  CreateAnnouncementDto,
  PreviewAudienceDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';
import { TenantAnnouncementsService } from './tenant-announcements.service';

/**
 * Epic 19, Stories 19.1–19.3 — one permission gates the section. Static
 * segments before `:id` routes (Nest matches in declaration order).
 */
@TenantScope()
@RequireModule('announcements')
@Controller('tenant/announcements')
export class TenantAnnouncementsController {
  constructor(private readonly announcements: TenantAnnouncementsService) {}

  @Get()
  @RequirePermissions('announcements.manage')
  list(@CurrentTenantUser() user: TenantUser) {
    return this.announcements.list(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('announcements.manage')
  create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.create(user, dto);
  }

  /** 19.1 AC2 — the live recipient count for the audience builder. */
  @Post('audience/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('announcements.manage')
  previewAudience(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: PreviewAudienceDto,
  ) {
    return this.announcements.previewAudience(user, dto);
  }

  @Get(':id')
  @RequirePermissions('announcements.manage')
  get(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions('announcements.manage')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(user, id, dto);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('announcements.manage')
  sendNow(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.sendNow(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('announcements.manage')
  cancelSchedule(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.cancelSchedule(user, id);
  }

  @Post(':id/retract')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('announcements.manage')
  retract(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.retract(user, id);
  }
}
