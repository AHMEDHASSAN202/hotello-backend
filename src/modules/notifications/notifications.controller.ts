import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Admin } from '../admins/admin.entity';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

/** Story 6.7 — read-only log plus resend; the outbox is append-only. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.read')
  findAll(@Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('notifications.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.getDetail(id);
  }

  @Post(':id/resend')
  @RequirePermissions('notifications.resend')
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.notificationsService.resend(id, actor);
  }
}
