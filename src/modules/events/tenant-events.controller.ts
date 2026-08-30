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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CancelEventDto } from './dto/cancel-event.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListTenantEventsQueryDto } from './dto/list-tenant-events-query.dto';
import { PublishEventDto } from './dto/publish-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EVENT_PHOTO_MAX_BYTES, EventPhotoService } from './event-photo.service';
import { TenantEventsService } from './tenant-events.service';

/**
 * Story 21.2/21.3 — event management (create/update/list/get/photo) plus
 * publish/cancel (Task 6, Epic 19 integration). Guest booking (Task 7) and
 * the attendees view (Task 8) are separate controllers/tasks, not this one.
 */
@TenantScope()
@RequireModule('events')
@Controller('tenant/events')
export class TenantEventsController {
  constructor(
    private readonly events: TenantEventsService,
    private readonly photos: EventPhotoService,
  ) {}

  @Get()
  @RequirePermissions('events.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListTenantEventsQueryDto,
  ) {
    return this.events.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('events.read')
  get(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.get(user, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('events.manage')
  create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateEventDto,
  ) {
    return this.events.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('events.manage')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(user, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('events.manage')
  publish(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishEventDto,
  ) {
    return this.events.publish(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('events.manage')
  cancel(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelEventDto,
  ) {
    return this.events.cancel(user, id, dto);
  }

  @Post(':id/photo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('events.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: EVENT_PHOTO_MAX_BYTES } }),
  )
  setPhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.photos.setPhoto(user, id, file);
  }

  @Delete(':id/photo')
  @RequirePermissions('events.manage')
  removePhoto(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.photos.removePhoto(user, id);
  }
}
