import {
  Body,
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
import { BookEventDto } from './dto/book-event.dto';
import { ListGuestEventsQueryDto } from './dto/list-guest-events-query.dto';
import { GuestEventsService } from './guest-events.service';

/**
 * Epic 21, Stories 21.4/21.5 — guest events routes, extending the shared
 * `guest` prefix (Epic 15/16/19 precedent: one `@Controller('guest')` per
 * feature, paths nested under it rather than a per-feature controller
 * prefix). Stay comes from the guest JWT only; `bookings` is declared
 * before `:id` so it never gets swallowed by the id param route.
 */
@GuestScope()
@Controller('guest')
export class GuestEventsController {
  constructor(private readonly events: GuestEventsService) {}

  @Get('events')
  listUpcoming(@CurrentGuestStay() stay: Stay) {
    return this.events.listUpcoming(stay);
  }

  @Get('events/bookings')
  myBookings(
    @CurrentGuestStay() stay: Stay,
    @Query() query: ListGuestEventsQueryDto,
  ) {
    return this.events.myBookings(stay, query);
  }

  @Get('events/:id')
  getDetail(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.getDetail(stay, id);
  }

  @Post('events/:id/book')
  @HttpCode(HttpStatus.CREATED)
  book(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BookEventDto,
  ) {
    return this.events.book(stay, id, dto);
  }

  @Post('events/bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOwn(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.cancelOwn(stay, id);
  }
}
