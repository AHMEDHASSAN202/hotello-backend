import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SetupAccountDto } from './dto/setup-account.dto';
import { TenantUsersService } from './tenant-users.service';

@Controller('tenant-users')
export class TenantUsersController {
  constructor(private readonly tenantUsersService: TenantUsersService) {}

  /** Public by design (the owner has no session yet) — hence rate-limited. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('setup')
  setup(@Body() dto: SetupAccountDto) {
    return this.tenantUsersService.setup(dto);
  }
}
