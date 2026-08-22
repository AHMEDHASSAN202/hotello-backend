import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { CreateGuestRequestDto } from './dto/create-guest-request.dto';
import { ListGuestRequestsQueryDto } from './dto/list-guest-requests-query.dto';
import { GuestRequestsService } from './guest-requests.service';

/**
 * Epic 15 — guest side of the requests loop (extends the /guest tree).
 * @GuestScope: the guest-jwt strategy reloads the Stay per request, so stay
 * validity IS session validity; every handler receives the authenticated
 * Stay and never a client-sent stay/room/hotel id (15.2 AC4).
 */
@GuestScope()
@Controller('guest')
export class GuestRequestsController {
  constructor(private readonly requests: GuestRequestsService) {}

  @Get('catalog')
  getCatalog(@CurrentGuestStay() stay: Stay) {
    return this.requests.getCatalog(stay);
  }

  @Get('requests')
  list(
    @CurrentGuestStay() stay: Stay,
    @Query() query: ListGuestRequestsQueryDto,
  ) {
    return this.requests.listForStay(stay, query);
  }

  @Post('requests')
  create(@CurrentGuestStay() stay: Stay, @Body() dto: CreateGuestRequestDto) {
    return this.requests.submit(stay, dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.cancelOwn(stay, id);
  }
}
