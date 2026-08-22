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
import {
  CreateGuestFnbOrderDto,
  ListGuestFnbOrdersQueryDto,
} from './dto/guest-fnb-order.dto';
import { GuestFnbService } from './guest-fnb.service';

/**
 * Epic 16, Stories 16.5/16.6 — guest F&B routes, extending the shared
 * `guest` prefix (Epic 15 second-controller precedent). Stay comes from the
 * guest JWT only; throttles are server-side in the service.
 */
@GuestScope()
@Controller('guest')
export class GuestFnbController {
  constructor(private readonly fnb: GuestFnbService) {}

  @Get('fnb/menus')
  getMenus(@CurrentGuestStay() stay: Stay) {
    return this.fnb.getMenus(stay);
  }

  @Post('fnb/orders')
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @CurrentGuestStay() stay: Stay,
    @Body() dto: CreateGuestFnbOrderDto,
  ) {
    return this.fnb.createOrder(stay, dto);
  }

  @Get('fnb/orders')
  listOrders(
    @CurrentGuestStay() stay: Stay,
    @Query() query: ListGuestFnbOrdersQueryDto,
  ) {
    return this.fnb.listForStay(stay, query);
  }

  @Post('fnb/orders/:id/cancel')
  @HttpCode(200)
  cancelOrder(
    @CurrentGuestStay() stay: Stay,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fnb.cancelOwn(stay, id);
  }
}
