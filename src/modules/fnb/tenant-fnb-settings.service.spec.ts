import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantFnbSettingsService } from './tenant-fnb-settings.service';

const actor = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

describe('TenantFnbSettingsService (16.4)', () => {
  let service: TenantFnbSettingsService;
  let hotelsRepo: { findOne: jest.Mock; save: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    hotelsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'hotel-1', fnbRoomChargeEnabled: false }),
      save: jest.fn(async (h) => h),
    };
    auditLogs = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantFnbSettingsService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantFnbSettingsService);
  });

  it('AC1 — cash is always on; room charge reads from the hotel column', async () => {
    await expect(service.getSettings('hotel-1')).resolves.toEqual({
      cashEnabled: true,
      roomChargeEnabled: false,
    });
  });

  it('AC1 — enabling room charge saves + audits a diff', async () => {
    const res = await service.updateSettings(actor, true);
    expect(res).toEqual({ cashEnabled: true, roomChargeEnabled: true });
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hotel.updated',
        metadata: expect.objectContaining({
          diff: { fnbRoomChargeEnabled: { from: false, to: true } },
        }),
      }),
    );
  });

  it('no-op when unchanged — no save, no audit', async () => {
    await service.updateSettings(actor, false);
    expect(hotelsRepo.save).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
