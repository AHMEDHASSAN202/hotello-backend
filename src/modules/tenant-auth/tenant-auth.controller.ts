import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { PasswordChangeExempt } from '../../common/decorators/password-change-exempt.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantPasswordResetConfirmDto } from './dto/tenant-password-reset-confirm.dto';
import { TenantPasswordResetRequestDto } from './dto/tenant-password-reset-request.dto';
import { TenantRefreshDto } from './dto/tenant-refresh.dto';
import { TenantAuthService } from './tenant-auth.service';

/**
 * Tenant Dashboard auth. The whole controller is @TenantScope(), so the global
 * guard authenticates non-public routes with the tenant-jwt strategy.
 * Public routes are rate-limited (the caller has no session yet).
 */
@TenantScope()
@PasswordChangeExempt()
@Controller('tenant/auth')
export class TenantAuthController {
  constructor(private readonly tenantAuthService: TenantAuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: TenantLoginDto) {
    return this.tenantAuthService.login(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: TenantRefreshDto) {
    return this.tenantAuthService.refresh(dto.refreshToken);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/request')
  @HttpCode(200)
  requestPasswordReset(@Body() dto: TenantPasswordResetRequestDto) {
    return this.tenantAuthService.requestPasswordReset(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  @HttpCode(200)
  confirmPasswordReset(@Body() dto: TenantPasswordResetConfirmDto) {
    return this.tenantAuthService.confirmPasswordReset(dto);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentTenantUser() user: TenantUser) {
    return this.tenantAuthService.logout(user.id);
  }
}
