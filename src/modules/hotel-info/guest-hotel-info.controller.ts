import { Controller, Get } from '@nestjs/common';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestHotelInfoService } from './guest-hotel-info.service';

/** Epic 17, Story 17.2 — the guest directory (language-resolved, cached). */
@GuestScope()
@Controller('guest')
export class GuestHotelInfoController {
  constructor(private readonly info: GuestHotelInfoService) {}

  @Get('hotel-info')
  getHotelInfo(@CurrentGuestStay() stay: Stay) {
    return this.info.getHotelInfo(stay);
  }
}
