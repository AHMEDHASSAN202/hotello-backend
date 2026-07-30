import { Test } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { TrialExpiryService } from './trial-expiry.service';

describe('TrialExpiryService', () => {
  let service: TrialExpiryService;
  let subscriptions: {
    emitTrialCountdowns: jest.Mock;
    expireOverdueTrials: jest.Mock;
  };

  beforeEach(async () => {
    subscriptions = {
      emitTrialCountdowns: jest.fn().mockResolvedValue(0),
      expireOverdueTrials: jest.fn().mockResolvedValue(0),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrialExpiryService,
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();
    service = moduleRef.get(TrialExpiryService);
  });

  describe('daily trial job (4.10 AC1 + 6.5)', () => {
    it('runs countdowns before expiry — an overdue trial gets the expiry notice, not a countdown', async () => {
      const order: string[] = [];
      subscriptions.emitTrialCountdowns.mockImplementation(async () => {
        order.push('countdowns');
        return 2;
      });
      subscriptions.expireOverdueTrials.mockImplementation(async () => {
        order.push('expiry');
        return 1;
      });

      await service.handleDailyExpiry();

      expect(order).toEqual(['countdowns', 'expiry']);
    });

    it('still expires overdue trials when countdown emission fails (notifications never block the core job)', async () => {
      subscriptions.emitTrialCountdowns.mockRejectedValue(
        new Error('db hiccup'),
      );

      await expect(service.handleDailyExpiry()).resolves.toBeUndefined();
      expect(subscriptions.expireOverdueTrials).toHaveBeenCalledTimes(1);
    });
  });
});
