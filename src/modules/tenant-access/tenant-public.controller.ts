import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { SetupPreviewDto } from './dto/setup-preview.dto';
import { TenantAccessService } from './tenant-access.service';

/**
 * Public, unauthenticated tenant endpoints consumed before login: the app
 * shell / lock page branding and the setup-page preview. Rate-limited since the
 * caller has no session.
 */
@Public()
@Controller('tenant/public')
export class TenantPublicController {
  constructor(
    private readonly access: TenantAccessService,
    private readonly tenantUsers: TenantUsersService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('context/:slug')
  context(@Param('slug') slug: string) {
    return this.access.getPublicContext(slug);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('setup/preview')
  @HttpCode(200)
  setupPreview(@Body() dto: SetupPreviewDto) {
    return this.tenantUsers.setupPreview(dto.token);
  }
}
