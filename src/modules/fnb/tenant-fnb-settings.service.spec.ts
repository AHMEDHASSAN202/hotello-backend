import { Test } from '@nestjs/testing';
import { TenantPaymentSettingsService } from '../hotel-settings/tenant-payment-settings.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantFnbSettingsService } from './tenant-fnb-settings.service';

const actor = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

// Epic 21, Story 21.1 AC2 refactored this service into a thin delegate to
// TenantPaymentSettingsService (its own spec: ../hotel-settings/tenant-
// payment-settings.service.spec.ts owns the save/audit/not-found behavior
// coverage this suite used to hold directly). This suite now proves the
// delegation itself; the round-trip spec proves both routes share state.
describe('TenantFnbSettingsService (16.4)', () => {
  let service: TenantFnbSettingsService;
  let paymentSettings: { getSettings: jest.Mock; updateSettings: jest.Mock };

  beforeEach(async () => {
    paymentSettings = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantFnbSettingsService,
        { provide: TenantPaymentSettingsService, useValue: paymentSettings },
      ],
    }).compile();
    service = moduleRef.get(TenantFnbSettingsService);
  });

  it('AC1 — getSettings delegates to TenantPaymentSettingsService', async () => {
    paymentSettings.getSettings.mockResolvedValue({
      cashEnabled: true,
      roomChargeEnabled: false,
    });

    await expect(service.getSettings('hotel-1')).resolves.toEqual({
      cashEnabled: true,
      roomChargeEnabled: false,
    });
    expect(paymentSettings.getSettings).toHaveBeenCalledWith('hotel-1');
  });

  it('AC1 — updateSettings delegates to TenantPaymentSettingsService', async () => {
    paymentSettings.updateSettings.mockResolvedValue({
      cashEnabled: true,
      roomChargeEnabled: true,
    });

    await expect(service.updateSettings(actor, true)).resolves.toEqual({
      cashEnabled: true,
      roomChargeEnabled: true,
    });
    expect(paymentSettings.updateSettings).toHaveBeenCalledWith(actor, true);
  });
});
