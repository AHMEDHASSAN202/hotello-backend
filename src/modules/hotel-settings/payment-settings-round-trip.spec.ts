import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantFnbSettingsService } from '../fnb/tenant-fnb-settings.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantPaymentSettingsService } from './tenant-payment-settings.service';

const actor = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

/**
 * Epic 21, Story 21.1 AC2 — proves `PATCH tenant/fnb/settings` and
 * `PATCH tenant/settings/payment-methods` are two faces of the same
 * hotel-level config: both services share one `TenantPaymentSettingsService`
 * instance reading/writing the same `hotel.roomChargeEnabled` row, so a
 * write through either route is visible through the other.
 */
describe('payment settings round-trip (21.1 AC2)', () => {
  it('a write via the F&B route is visible via the generic settings route, and vice versa', async () => {
    const hotelRow = { id: 'hotel-1', roomChargeEnabled: false };
    const hotelsRepo = {
      findOne: jest.fn().mockResolvedValue(hotelRow),
      save: jest.fn(async (h: typeof hotelRow) => {
        Object.assign(hotelRow, h);
        return hotelRow;
      }),
    } as any;
    const auditLogs = { log: jest.fn() } as unknown as AuditLogsService;

    const paymentSettings = new TenantPaymentSettingsService(
      hotelsRepo,
      auditLogs,
    );
    const fnbSettings = new TenantFnbSettingsService(paymentSettings);

    // Write through the legacy F&B route...
    await fnbSettings.updateSettings(actor, true);
    // ...is visible through the new generic settings route.
    await expect(paymentSettings.getSettings('hotel-1')).resolves.toEqual({
      cashEnabled: true,
      roomChargeEnabled: true,
    });

    // Write through the new generic settings route...
    await paymentSettings.updateSettings(actor, false);
    // ...is visible through the legacy F&B route.
    await expect(fnbSettings.getSettings('hotel-1')).resolves.toEqual({
      cashEnabled: true,
      roomChargeEnabled: false,
    });
  });
});
