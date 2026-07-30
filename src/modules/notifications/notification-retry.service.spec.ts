import { Test } from '@nestjs/testing';
import { NotificationRetryService } from './notification-retry.service';
import { NotificationsService } from './notifications.service';

describe('NotificationRetryService', () => {
  let service: NotificationRetryService;
  let notifications: { processDue: jest.Mock };

  beforeEach(async () => {
    notifications = { processDue: jest.fn().mockResolvedValue(0) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationRetryService,
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(NotificationRetryService);
  });

  describe('retry worker (6.1 AC2)', () => {
    it('delegates each tick to the testable processDue()', async () => {
      notifications.processDue.mockResolvedValue(3);
      await service.handleDueNotifications();
      expect(notifications.processDue).toHaveBeenCalledTimes(1);
    });

    it('skips a tick while the previous batch is still in flight (no double-send)', async () => {
      let finishFirst!: (count: number) => void;
      notifications.processDue.mockReturnValueOnce(
        new Promise<number>((resolve) => (finishFirst = resolve)),
      );

      const first = service.handleDueNotifications();
      // Second tick fires while the first batch is still sending.
      await service.handleDueNotifications();
      expect(notifications.processDue).toHaveBeenCalledTimes(1);

      finishFirst(1);
      await first;
      // Once the batch finishes, the next tick runs normally.
      await service.handleDueNotifications();
      expect(notifications.processDue).toHaveBeenCalledTimes(2);
    });

    it('releases the lock even when a batch throws', async () => {
      notifications.processDue.mockRejectedValueOnce(new Error('db down'));
      await expect(service.handleDueNotifications()).rejects.toThrow('db down');
      notifications.processDue.mockResolvedValue(0);
      await service.handleDueNotifications();
      expect(notifications.processDue).toHaveBeenCalledTimes(2);
    });
  });
});
