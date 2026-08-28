import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { ListGuestAnnouncementsQueryDto } from './dto/announcements.dto';
import { GuestAnnouncementsService } from './guest-announcements.service';

/** Epic 19, Story 19.4 — the guest inbox feed + lazy read receipts. */
@GuestScope()
@Controller('guest')
export class GuestAnnouncementsController {
  constructor(private readonly announcements: GuestAnnouncementsService) {}

  @Get('announcements')
  list(
    @CurrentGuestStay() stay: Stay,
    @Query() query: ListGuestAnnouncementsQueryDto,
  ) {
    return this.announcements.listForStay(stay, query);
  }

  @Post('announcements/:id/read')
  @HttpCode(HttpStatus.OK)
  read(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.markRead(stay, id);
  }
}
