import { Test } from '@nestjs/testing';
import { PushDispatchService } from './push-dispatch.service';
import { PushRetryService } from './push-retry.service';

describe('PushRetryService', () => {
  let service: PushRetryService;
  let dispatch: { processDue: jest.Mock; pruneOld: jest.Mock };

  beforeEach(async () => {
    dispatch = {
      processDue: jest.fn().mockResolvedValue(0),
      pruneOld: jest.fn().mockResolvedValue(0),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushRetryService,
        { provide: PushDispatchService, useValue: dispatch },
      ],
    }).compile();
    service = moduleRef.get(PushRetryService);
  });

  describe('retry worker (23.1 AC2)', () => {
    it('delegates each tick to the testable processDue()', async () => {
      dispatch.processDue.mockResolvedValue(3);
      await service.handleDueDispatches();
      expect(dispatch.processDue).toHaveBeenCalledTimes(1);
    });

    it('skips a tick while the previous batch is still in flight (no double-send)', async () => {
      let finishFirst!: (count: number) => void;
      dispatch.processDue.mockReturnValueOnce(
        new Promise<number>((resolve) => (finishFirst = resolve)),
      );

      const first = service.handleDueDispatches();
      // Second tick fires while the first batch is still sending.
      await service.handleDueDispatches();
      expect(dispatch.processDue).toHaveBeenCalledTimes(1);

      finishFirst(1);
      await first;
      // Once the batch finishes, the next tick runs normally.
      await service.handleDueDispatches();
      expect(dispatch.processDue).toHaveBeenCalledTimes(2);
    });

    it('releases the lock even when a batch throws', async () => {
      dispatch.processDue.mockRejectedValueOnce(new Error('db down'));
      await expect(service.handleDueDispatches()).rejects.toThrow('db down');
      dispatch.processDue.mockResolvedValue(0);
      await service.handleDueDispatches();
      expect(dispatch.processDue).toHaveBeenCalledTimes(2);
    });

    it('a prune tick does not block a concurrent retry tick (separate re-entrancy flags)', async () => {
      let finishPrune!: (count: number) => void;
      dispatch.pruneOld.mockReturnValueOnce(
        new Promise<number>((resolve) => (finishPrune = resolve)),
      );

      const prune = service.handlePrune();
      await service.handleDueDispatches();
      expect(dispatch.processDue).toHaveBeenCalledTimes(1);

      finishPrune(0);
      await prune;
    });
  });

  describe('prune worker (retention)', () => {
    it('delegates each tick to the testable pruneOld()', async () => {
      dispatch.pruneOld.mockResolvedValue(7);
      await service.handlePrune();
      expect(dispatch.pruneOld).toHaveBeenCalledTimes(1);
    });

    it('skips a prune tick while the previous one is still in flight', async () => {
      let finishFirst!: (count: number) => void;
      dispatch.pruneOld.mockReturnValueOnce(
        new Promise<number>((resolve) => (finishFirst = resolve)),
      );

      const first = service.handlePrune();
      await service.handlePrune();
      expect(dispatch.pruneOld).toHaveBeenCalledTimes(1);

      finishFirst(2);
      await first;
      await service.handlePrune();
      expect(dispatch.pruneOld).toHaveBeenCalledTimes(2);
    });
  });
});
