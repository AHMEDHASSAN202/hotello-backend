import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantPaymentSettingsService } from './tenant-payment-settings.service';

export class UpdatePaymentSettingsDto {
  @IsBoolean()
  roomChargeEnabled: boolean;
}

/**
 * Epic 21, Story 21.1 AC2 — hotel-level payment-methods settings, generic
 * (not module-gated): F&B and Events both read/write the same toggle here.
 * `GET/PATCH tenant/fnb/settings` keeps working unchanged, delegating to the
 * same service underneath (see TenantFnbSettingsService).
 */
@TenantScope()
@Controller('tenant/settings')
export class TenantPaymentSettingsController {
  constructor(private readonly settings: TenantPaymentSettingsService) {}

  @Get('payment-methods')
  @RequirePermissions('fnb_settings.manage')
  getSettings(@CurrentTenantUser() user: TenantUser) {
    return this.settings.getSettings(user.hotelId);
  }

  @Patch('payment-methods')
  @RequirePermissions('fnb_settings.manage')
  updateSettings(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpdatePaymentSettingsDto,
  ) {
    return this.settings.updateSettings(user, dto.roomChargeEnabled);
  }
}
