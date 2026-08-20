import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentGuestStay } from '../../common/decorators/current-guest-stay.decorator';
import { GuestScope } from '../../common/decorators/guest-scope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestSessionDto } from './dto/guest-session.dto';
import { GuestSessionService } from './guest-session.service';

/**
 * The public guest tree (13.5) — only these endpoints exist in it for now;
 * the Guest App epic consumes this contract verbatim. Entry carries a coarse
 * per-IP throttle on top of the layered GuestRateLimitService.
 */
@Controller('guest')
export class GuestController {
  constructor(private readonly sessions: GuestSessionService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':slug/session')
  @HttpCode(HttpStatus.OK)
  createSession(
    @Param('slug') slug: string,
    @Body() dto: GuestSessionDto,
    @Ip() ip: string,
  ) {
    return this.sessions.createSession(slug, dto, ip ?? 'unknown');
  }

  /** AC6 — the "session still valid?" probe the app boots from. */
  @GuestScope()
  @Get('me')
  me(@CurrentGuestStay() stay: Stay) {
    return this.sessions.profileFor(stay);
  }
}
