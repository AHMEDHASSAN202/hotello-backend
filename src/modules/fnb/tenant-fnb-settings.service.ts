import { Injectable } from '@nestjs/common';
import {
  PaymentSettingsView,
  TenantPaymentSettingsService,
} from '../hotel-settings/tenant-payment-settings.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';

export type FnbSettingsView = PaymentSettingsView;

/**
 * Epic 16, Story 16.4 — F&B payment-methods settings. Epic 21, Story 21.1
 * AC2 lifted the actual config to hotel level (`hotel.roomChargeEnabled`,
 * shared with Events); this is now a thin wrapper delegating to
 * TenantPaymentSettingsService — one source of truth. `GET/PATCH
 * tenant/fnb/settings` keep their route, DTO and response shape unchanged.
 */
@Injectable()
export class TenantFnbSettingsService {
  constructor(
    private readonly paymentSettings: TenantPaymentSettingsService,
  ) {}

  getSettings(hotelId: string): Promise<FnbSettingsView> {
    return this.paymentSettings.getSettings(hotelId);
  }

  updateSettings(
    actor: TenantUser,
    roomChargeEnabled: boolean,
  ): Promise<FnbSettingsView> {
    return this.paymentSettings.updateSettings(actor, roomChargeEnabled);
  }
}
