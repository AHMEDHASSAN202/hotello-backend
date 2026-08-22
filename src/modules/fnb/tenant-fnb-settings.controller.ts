import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantFnbSettingsService } from './tenant-fnb-settings.service';

export class UpdateFnbSettingsDto {
  @IsBoolean()
  roomChargeEnabled: boolean;
}

/** Epic 16, Story 16.4 — F&B payment-methods settings. */
@TenantScope()
@RequireModule('fnb')
@Controller('tenant/fnb')
export class TenantFnbSettingsController {
  constructor(private readonly settings: TenantFnbSettingsService) {}

  @Get('settings')
  @RequirePermissions('fnb_settings.manage')
  getSettings(@CurrentTenantUser() user: TenantUser) {
    return this.settings.getSettings(user.hotelId);
  }

  @Patch('settings')
  @RequirePermissions('fnb_settings.manage')
  updateSettings(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: UpdateFnbSettingsDto,
  ) {
    return this.settings.updateSettings(user, dto.roomChargeEnabled);
  }
}
