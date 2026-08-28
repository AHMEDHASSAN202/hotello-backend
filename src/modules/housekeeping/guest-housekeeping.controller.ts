import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { SetDndDto } from './dto/set-dnd.dto';
import { HousekeepingService } from './housekeeping.service';

/**
 * Epic 20, Story 20.4 — the guest Do-Not-Disturb switch. Room and hotel
 * derive from the JWT-loaded stay (identity = session); module gating lives
 * in the service (TenantAccessGuard no-ops on @GuestScope routes).
 */
@GuestScope()
@Controller('guest')
export class GuestHousekeepingController {
  constructor(private readonly housekeeping: HousekeepingService) {}

  @Post('dnd')
  @HttpCode(200)
  setDnd(@CurrentGuestStay() stay: Stay, @Body() dto: SetDndDto) {
    return this.housekeeping.setDnd(stay, dto.active);
  }
}
