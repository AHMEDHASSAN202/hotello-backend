import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AutoCheckoutService } from './auto-checkout.service';
import { Stay } from './stay.entity';

const cairoHotel = { checkoutTime: '12:00', timezone: 'Africa/Cairo' };

const makeStay = (o: Record<string, unknown>) => ({
  id: 'stay-1',
  hotelId: 'hotel-1',
  status: 'active',
  hotel: { ...cairoHotel },
  room: { roomNumber: '101' },
  ...o,
});

describe('AutoCheckoutService', () => {
  let service: AutoCheckoutService;
  let staysRepo: { find: jest.Mock; save: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    staysRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn(async (s) => s) };
    auditLogs = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutoCheckoutService,
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(AutoCheckoutService);
  });

  describe('closeOverdueStays (13.4 AC3)', () => {
    it('only ever selects active stays — a re-run is naturally idempotent', async () => {
      await service.closeOverdueStays(new Date('2026-08-20T10:00:00Z'));
      expect(staysRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
          relations: ['hotel', 'room'],
        }),
      );
    });

    it('closes overdue stays as automatic with a system-actor audit', async () => {
      // Cairo local 13:00 — past the 12:00 checkout on the stay's date.
      const now = new Date('2026-08-20T10:00:00Z');
      staysRepo.find.mockResolvedValue([
        makeStay({ id: 'due', checkOutDate: '2026-08-20' }),
        makeStay({ id: 'not-due', checkOutDate: '2026-08-21' }),
      ]);

      const closed = await service.closeOverdueStays(now);

      expect(closed).toEqual(1);
      expect(staysRepo.save).toHaveBeenCalledTimes(1);
      const saved = staysRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        id: 'due',
        status: 'checked_out',
        checkoutType: 'automatic',
        checkedOutById: null,
      });
      expect(saved.checkedOutAt).toEqual(now);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stay.checked_out',
          entityId: 'due',
          actorId: null,
          metadata: expect.objectContaining({ checkoutType: 'automatic' }),
        }),
      );
    });

    it('respects each hotel’s own timezone in the same run', async () => {
      // 20:45 UTC on the 19th: Dubai (00:45 on the 20th, checkout 00:30) is
      // due; New York (16:45 on the 19th) with the same wall-clock setting
      // is a full day away.
      const now = new Date('2026-08-19T20:45:00Z');
      staysRepo.find.mockResolvedValue([
        makeStay({
          id: 'dubai',
          checkOutDate: '2026-08-20',
          hotel: { checkoutTime: '00:30', timezone: 'Asia/Dubai' },
        }),
        makeStay({
          id: 'nyc',
          checkOutDate: '2026-08-20',
          hotel: { checkoutTime: '00:30', timezone: 'America/New_York' },
        }),
      ]);

      await service.closeOverdueStays(now);

      expect(staysRepo.save).toHaveBeenCalledTimes(1);
      expect(staysRepo.save.mock.calls[0][0].id).toEqual('dubai');
    });
  });

  describe('handleHourlyAutoCheckout', () => {
    it('skips a tick while the previous run is still going (re-entrancy)', async () => {
      let resolveFind!: (v: unknown) => void;
      staysRepo.find.mockReturnValue(new Promise((r) => (resolveFind = r)));

      const first = service.handleHourlyAutoCheckout();
      await service.handleHourlyAutoCheckout(); // overlapping tick
      resolveFind([]);
      await first;

      expect(staysRepo.find).toHaveBeenCalledTimes(1);
    });
  });
});
