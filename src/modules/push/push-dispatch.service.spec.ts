import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { DispatchInput, PushDispatchService } from './push-dispatch.service';
import { PushDispatch } from './push-dispatch.entity';
import { PushSubscription } from './push-subscription.entity';
import { PUSH_DRIVER, PushSendError } from './push.interface';

const BASE_MS = 60_000; // PUSH_RETRY_BASE_MS default

describe('PushDispatchService (23.1 AC2/AC3)', () => {
  let service: PushDispatchService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let subsRepo: { findOne: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let staysRepo: { findOne: jest.Mock };
  let driver: { send: jest.Mock };

  const activeStay = {
    id: 'stay-1',
    status: 'active',
    hotel: { id: 'hotel-1', status: 'active' },
  };

  const sub = {
    id: 'sub-1',
    hotelId: 'hotel-1',
    stayId: 'stay-1',
    endpoint: 'https://push.example/abc',
    p256dh: 'p256-key',
    auth: 'auth-key',
    deviceHint: null,
    failureCount: 0,
    lastSuccessAt: null,
  };

  const makeInput = (overrides: Partial<DispatchInput> = {}): DispatchInput => ({
    hotelId: 'hotel-1',
    stayId: 'stay-1',
    subscriptionId: 'sub-1',
    type: 'order_status',
    refId: 'order-1',
    title: 'Order update',
    body: 'Your order is on the way',
    url: '/sunrise?open=order:order-1',
    ttlSeconds: 900,
    topic: null,
    dedupeKey: null,
    deliverAfter: null,
    ...overrides,
  });

  const makeRow = (overrides: Partial<PushDispatch> = {}): PushDispatch =>
    ({
      id: 'dispatch-1',
      hotelId: 'hotel-1',
      stayId: 'stay-1',
      subscriptionId: 'sub-1',
      type: 'order_status',
      refId: 'order-1',
      title: 'Order update',
      body: 'Your order is on the way',
      url: '/sunrise?open=order:order-1',
      ttlSeconds: 900,
      topic: null,
      dedupeKey: null,
      status: 'pending',
      deliverAfter: null,
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      attempts: [],
      sentAt: null,
      ...overrides,
    }) as PushDispatch;

  beforeEach(async () => {
    repo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: row.id ?? 'dispatch-new', ...row })),
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(),
    };
    subsRepo = {
      findOne: jest.fn().mockResolvedValue({ ...sub }),
      save: jest.fn(async (s) => s),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    staysRepo = {
      findOne: jest.fn().mockResolvedValue({ ...activeStay }),
    };
    driver = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushDispatchService,
        { provide: getRepositoryToken(PushDispatch), useValue: repo },
        { provide: getRepositoryToken(PushSubscription), useValue: subsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: PUSH_DRIVER, useValue: driver },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, fallback?: unknown) => fallback) },
        },
      ],
    }).compile();

    service = moduleRef.get(PushDispatchService);
  });

  describe('enqueueAndSend', () => {
    it('persists rows before attempting (row exists even if the driver throws immediately after)', async () => {
      driver.send.mockRejectedValue(new Error('network down'));

      await service.enqueueAndSend([makeInput()]);

      expect(repo.save).toHaveBeenCalled();
      expect(driver.send).toHaveBeenCalled();
      // Persist-first: the row is saved before the driver is ever invoked.
      expect(repo.save.mock.invocationCallOrder[0]).toBeLessThan(
        driver.send.mock.invocationCallOrder[0],
      );
      expect(repo.save.mock.calls[0][0]).toEqual(
        expect.objectContaining({ status: 'pending', attemptCount: 0 }),
      );
    });

    it('supersedes pending rows sharing the same topic (collapse, 23.4 AC3)', async () => {
      await service.enqueueAndSend([
        makeInput({ topic: 'order-123', subscriptionId: 'sub-1' }),
      ]);

      expect(repo.update).toHaveBeenCalledWith(
        { topic: 'order-123', subscriptionId: 'sub-1', status: 'pending' },
        { status: 'superseded', nextAttemptAt: null },
      );
      // Ordering: supersede runs BEFORE the new row is inserted, so the new
      // row (not yet 'pending' in the DB) can never supersede itself.
      expect(repo.update.mock.invocationCallOrder[0]).toBeLessThan(
        repo.save.mock.invocationCallOrder[0],
      );
    });

    it('held rows (deliverAfter in the future) are NOT dispatched immediately', async () => {
      const deliverAfter = new Date(Date.now() + 3_600_000);

      await service.enqueueAndSend([makeInput({ deliverAfter })]);

      expect(driver.send).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deliverAfter, nextAttemptAt: deliverAfter }),
      );
    });

    it('a duplicate dedupeKey is swallowed as a no-op (23505)', async () => {
      const uniqueErr = new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      repo.save.mockRejectedValueOnce(uniqueErr);

      await expect(
        service.enqueueAndSend([makeInput({ dedupeKey: 'order:1:preparing' })]),
      ).resolves.toBeUndefined();

      expect(driver.send).not.toHaveBeenCalled();
    });

    it('never throws — driver explosion (even a non-Error rejection) is contained', async () => {
      driver.send.mockRejectedValue('raw string explosion');

      await expect(service.enqueueAndSend([makeInput()])).resolves.toBeUndefined();

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: 'raw string explosion', status: 'pending' }),
      );
    });

    it('never throws — an unexpected DB error during supersede is contained', async () => {
      repo.update.mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        service.enqueueAndSend([makeInput({ topic: 'order-123' })]),
      ).resolves.toBeUndefined();
    });
  });

  describe('attemptSend', () => {
    it('gates on stay validity: checked_out stay → terminal failure, no driver call (AC3)', async () => {
      staysRepo.findOne.mockResolvedValue({
        id: 'stay-1',
        status: 'checked_out',
        hotel: { id: 'hotel-1', status: 'active' },
      });
      const row = makeRow();

      await service.attemptSend(row);

      expect(driver.send).not.toHaveBeenCalled();
      expect(row.status).toBe('failed');
      expect(row.nextAttemptAt).toBeNull();
      expect(repo.save).toHaveBeenCalledWith(row);
    });

    it('gates on hotel status: suspended hotel → terminal failure', async () => {
      staysRepo.findOne.mockResolvedValue({
        id: 'stay-1',
        status: 'active',
        hotel: { id: 'hotel-1', status: 'suspended' },
      });
      const row = makeRow();

      await service.attemptSend(row);

      expect(driver.send).not.toHaveBeenCalled();
      expect(row.status).toBe('failed');
      expect(row.nextAttemptAt).toBeNull();
    });

    it('410 from the driver prunes the subscription and fails terminally (AC3)', async () => {
      driver.send.mockRejectedValue(new PushSendError('gone', 410));
      const row = makeRow();

      await service.attemptSend(row);

      expect(subsRepo.delete).toHaveBeenCalledWith({ id: sub.id });
      expect(row.status).toBe('failed');
      expect(row.nextAttemptAt).toBeNull();
    });

    it('retryable failure schedules exponential backoff (base, 2×base…)', async () => {
      driver.send.mockRejectedValue(new Error('temporary failure'));
      const row = makeRow({ attemptCount: 0 });
      const before = Date.now();

      await service.attemptSend(row);

      expect(row.attemptCount).toBe(1);
      expect(row.status).toBe('pending');
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + BASE_MS);
      expect(row.nextAttemptAt!.getTime()).toBeLessThan(before + BASE_MS + 5_000);

      driver.send.mockRejectedValue(new Error('still failing'));
      const row2 = makeRow({ attemptCount: 1 });
      const before2 = Date.now();

      await service.attemptSend(row2);

      expect(row2.attemptCount).toBe(2);
      expect(row2.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before2 + 2 * BASE_MS);
    });

    it('failure at max attempts goes terminal (failed, nextAttemptAt null)', async () => {
      driver.send.mockRejectedValue(new Error('still failing'));
      const row = makeRow({ attemptCount: 2 }); // default max attempts = 3

      await service.attemptSend(row);

      expect(row.attemptCount).toBe(3);
      expect(row.status).toBe('failed');
      expect(row.nextAttemptAt).toBeNull();
    });

    it('success stamps sentAt + subscription.lastSuccessAt', async () => {
      subsRepo.findOne.mockResolvedValue({ ...sub, failureCount: 4 });
      const row = makeRow();

      await service.attemptSend(row);

      expect(row.status).toBe('sent');
      expect(row.sentAt).toBeInstanceOf(Date);
      expect(subsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: sub.id, failureCount: 0, lastSuccessAt: expect.any(Date) }),
      );
    });
  });

  describe('processDue', () => {
    it('picks only pending rows with nextAttemptAt <= now, oldest first, in a bounded batch', async () => {
      const due = [makeRow({ id: 'd1' }), makeRow({ id: 'd2' })];
      repo.find.mockResolvedValue(due);

      const count = await service.processDue();

      expect(count).toBe(2);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          order: { nextAttemptAt: 'ASC' },
          take: 50,
        }),
      );
      expect(driver.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('pruneOld', () => {
    it('deletes sent/failed/superseded rows older than PUSH_RETENTION_DAYS, keeps pending', async () => {
      repo.delete.mockResolvedValue({ affected: 4 });
      const before = Date.now();

      const count = await service.pruneOld();

      expect(count).toBe(4);
      expect(repo.delete).toHaveBeenCalledTimes(1);
      const criteria = repo.delete.mock.calls[0][0];
      expect(criteria.status.value).toEqual(['sent', 'failed', 'superseded']);
      expect(criteria.status.value).not.toContain('pending');
      expect(criteria.updatedAt.type).toBe('lessThan');
      // naiveUtc wraps the cutoff as an ISO STRING, never a raw Date — a raw
      // Date param here is the exact host-timezone bug naiveUtc exists to avoid.
      expect(typeof criteria.updatedAt.value).toBe('string');
      const cutoffMs = Date.parse(criteria.updatedAt.value);
      const expectedCutoff = before - 30 * 24 * 3600 * 1000;
      expect(cutoffMs).toBeGreaterThanOrEqual(expectedCutoff - 5_000);
      expect(cutoffMs).toBeLessThanOrEqual(expectedCutoff + 5_000);
    });
  });

  describe('statsForRefs', () => {
    it('aggregates sent/failed counts grouped by refId', async () => {
      const rows = [
        { refId: 'ann-1', status: 'sent', count: '3' },
        { refId: 'ann-1', status: 'failed', count: '1' },
        { refId: 'ann-2', status: 'sent', count: '5' },
      ];
      repo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      });

      const stats = await service.statsForRefs(['ann-1', 'ann-2']);

      expect(stats.get('ann-1')).toEqual({ sent: 3, failed: 1 });
      expect(stats.get('ann-2')).toEqual({ sent: 5, failed: 0 });
    });

    it('returns an empty map for an empty input without querying', async () => {
      const stats = await service.statsForRefs([]);

      expect(stats.size).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
