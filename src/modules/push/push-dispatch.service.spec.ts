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
    manager: { transaction: jest.Mock };
  };
  let subsRepo: { findOne: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let staysRepo: { findOne: jest.Mock };
  let driver: { send: jest.Mock };
  // The transactional EntityManager handed to the callback passed to
  // repo.manager.transaction(). getRepository() is wired to return the same
  // `repo` mock, so existing assertions against repo.create/save/update stay
  // valid unchanged — only the new advisory-lock query needs its own mock.
  let txManager: { getRepository: jest.Mock; query: jest.Mock };

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
      // Default: the guarded conditional update (recordSuccess/recordFailure)
      // finds the row still pending and applies — matches the old blind-save
      // behavior for every test that doesn't specifically exercise the race
      // (affected: 0) below.
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(),
      manager: null as unknown as { transaction: jest.Mock },
    };
    txManager = {
      getRepository: jest.fn(() => repo),
      query: jest.fn().mockResolvedValue(undefined),
    };
    repo.manager = {
      transaction: jest.fn(async (cb: (m: typeof txManager) => Promise<unknown>) =>
        cb(txManager),
      ),
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

      // recordFailure now persists via the guarded update, not repo.save.
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
        expect.objectContaining({ lastError: 'raw string explosion', status: 'pending' }),
      );
    });

    it('never throws — an unexpected DB error during supersede is contained', async () => {
      repo.update.mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        service.enqueueAndSend([makeInput({ topic: 'order-123' })]),
      ).resolves.toBeUndefined();
    });

    it('runs the supersede+insert inside one transaction, serialized by a per-(topic, subscriptionId) advisory lock', async () => {
      // Closes the cross-call TOCTOU race: two overlapping enqueueAndSend
      // calls for the same topic+subscription could otherwise each fail to
      // see the other's still-uncommitted pending row and both insert,
      // defeating collapse (double-send). The advisory lock serializes them;
      // wrapping supersede+insert in one transaction means the lock, the
      // supersede-UPDATE and the INSERT all see a consistent snapshot.
      await service.enqueueAndSend([
        makeInput({ topic: 'order-123', subscriptionId: 'sub-1' }),
      ]);

      expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['order-123:sub-1'],
      );
      // Lock → supersede-update → insert, in that order, all inside the
      // transaction (getRepository is called on the SAME txManager passed
      // to the callback, not on `this.repo` directly).
      expect(txManager.getRepository).toHaveBeenCalledWith(PushDispatch);
      expect(txManager.query.mock.invocationCallOrder[0]).toBeLessThan(
        repo.update.mock.invocationCallOrder[0],
      );
      expect(repo.update.mock.invocationCallOrder[0]).toBeLessThan(
        repo.save.mock.invocationCallOrder[0],
      );
    });

    it('skips the advisory lock and supersede-update entirely when the input has no topic', async () => {
      await service.enqueueAndSend([makeInput({ topic: null })]);

      expect(txManager.query).not.toHaveBeenCalled();
      // No topic-keyed supersede update should run. (repo.update IS still
      // called once here for the immediate send's recordSuccess — that's the
      // separate guarded-write path, unrelated to collapse/supersede.)
      const supersedeCalls = repo.update.mock.calls.filter(([criteria]) => 'topic' in criteria);
      expect(supersedeCalls).toHaveLength(0);
      expect(repo.save).toHaveBeenCalled();
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
      // recordFailure persists via a guarded conditional update (WHERE id
      // AND status = 'pending'), never a blind full-entity save.
      expect(repo.update).toHaveBeenCalledWith(
        { id: row.id, status: 'pending' },
        expect.objectContaining({ status: 'failed', nextAttemptAt: null }),
      );
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

    // Calling attemptSend() DIRECTLY here (not via enqueueAndSend) matters:
    // enqueueAndSend has its own outer try/catch that would otherwise mask
    // an attemptSend that isn't exception-safe on its own. processDue()'s
    // loop has no such wrapper, and PushRetryService's cron handler has no
    // catch either — an uncaught rejection here would crash the whole
    // process (no global unhandledRejection handler exists in main.ts).
    it('never throws when the stay lookup itself fails (transient DB error, not a business gate)', async () => {
      staysRepo.findOne.mockRejectedValue(new Error('connection timeout'));
      const row = makeRow();

      await expect(service.attemptSend(row)).resolves.toBeUndefined();

      expect(driver.send).not.toHaveBeenCalled();
      expect(row.lastError).toBe('connection timeout');
      // Non-terminal: a transient infra hiccup gets retried, not permanently failed.
      expect(row.status).toBe('pending');
      expect(row.nextAttemptAt).not.toBeNull();
    });

    it('never throws when the subscription lookup itself fails', async () => {
      subsRepo.findOne.mockRejectedValue(new Error('pool exhausted'));
      const row = makeRow();

      await expect(service.attemptSend(row)).resolves.toBeUndefined();

      expect(driver.send).not.toHaveBeenCalled();
      expect(row.lastError).toBe('pool exhausted');
      expect(row.status).toBe('pending');
    });

    it('never throws when deleting the pruned subscription fails during 410-handling', async () => {
      driver.send.mockRejectedValue(new PushSendError('gone', 410));
      subsRepo.delete.mockRejectedValue(new Error('delete failed'));
      const row = makeRow();

      await expect(service.attemptSend(row)).resolves.toBeUndefined();

      expect(row.lastError).toBe('delete failed');
      // Couldn't confirm the prune committed — retry rather than
      // terminal-fail so the delete is naturally retried alongside the send.
      expect(row.status).toBe('pending');
    });

    it('never throws even when persisting the failure itself fails (last-resort log, not a crash)', async () => {
      staysRepo.findOne.mockRejectedValue(new Error('db unreachable'));
      repo.update.mockRejectedValue(new Error('db totally down'));
      const row = makeRow();

      await expect(service.attemptSend(row)).resolves.toBeUndefined();
    });

    describe('concurrent-supersede guard (recordSuccess/recordFailure race fix)', () => {
      // The bug (live smoke test, Epic 23 task 16): recordSuccess/recordFailure
      // used to do a blind `repo.save(row)` on an in-memory row snapshot with
      // no `WHERE status = 'pending'` guard. If a concurrent enqueueAndSend
      // collapse-supersede flipped the row to 'superseded' in the DB WHILE an
      // older attemptSend for that same row was still in flight, the older
      // call's blind save would silently overwrite status back to 'sent' or
      // 'failed' — resurrecting a dispatch that had already correctly
      // collapsed away. These tests simulate that outcome via a mocked
      // `repo.update` returning `{ affected: 0 }`, i.e. "another writer moved
      // this row off 'pending' before this write landed."

      it('recordSuccess no-ops when the row was concurrently superseded (affected: 0) — does not resurrect status', async () => {
        repo.update.mockResolvedValueOnce({ affected: 0 });
        // In-memory snapshot is still 'pending' — that's exactly what let
        // attemptSend proceed to call the driver in the first place, even
        // though the row's TRUE DB state has already moved on.
        const row = makeRow({ status: 'pending' });

        await expect(service.attemptSend(row)).resolves.toBeUndefined();

        expect(driver.send).toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(
          { id: row.id, status: 'pending' },
          expect.objectContaining({ status: 'sent' }),
        );
        // No-op: the in-memory row must NOT be mutated to reflect a write
        // that never actually landed, and no further recovery/retry write
        // is attempted for this row.
        expect(row.status).toBe('pending');
        expect(row.sentAt).toBeNull();
        expect(repo.update).toHaveBeenCalledTimes(1);
        // Subscription health bookkeeping is part of "this row's write" too
        // — must not proceed once the guard reports the row moved on.
        expect(subsRepo.save).not.toHaveBeenCalled();
      });

      it('recordFailure no-ops when the row was concurrently superseded (affected: 0) — does not resurrect status', async () => {
        driver.send.mockRejectedValue(new Error('temporary failure'));
        repo.update.mockResolvedValueOnce({ affected: 0 });
        const row = makeRow({ status: 'pending', attemptCount: 0, lastError: null });

        await expect(service.attemptSend(row)).resolves.toBeUndefined();

        expect(repo.update).toHaveBeenCalledWith(
          { id: row.id, status: 'pending' },
          expect.objectContaining({ status: 'pending', attemptCount: 1 }),
        );
        // No-op: nothing about the row's in-memory state changes, and the
        // subscription failureCount bump (a side effect of a landed write)
        // must not happen either.
        expect(row.attemptCount).toBe(0);
        expect(row.lastError).toBeNull();
        expect(repo.update).toHaveBeenCalledTimes(1);
        expect(subsRepo.save).not.toHaveBeenCalled();
      });

      it('a lagging attemptSend for an already-superseded row cannot resurrect it (race outcome simulation)', async () => {
        // Model the DB as a tiny state machine: the guarded update only
        // "lands" (affected: 1) if its WHERE-criteria status still matches
        // the current DB status; otherwise it's a no-op (affected: 0) — this
        // is exactly what a real `UPDATE ... WHERE id = :id AND status =
        // :status` does against a real row.
        let dbStatus: string = 'pending';
        repo.update.mockImplementation(async (criteria: Record<string, unknown>, set: Record<string, unknown>) => {
          if (criteria.status !== dbStatus) return { affected: 0 };
          dbStatus = (set.status as string) ?? dbStatus;
          return { affected: 1 };
        });

        // A concurrent enqueueAndSend collapse already superseded this row
        // in the DB before the older in-flight attemptSend's recordSuccess
        // gets a chance to write.
        dbStatus = 'superseded';

        const row = makeRow({ status: 'pending' }); // stale snapshot the older call is still holding
        await service.attemptSend(row);

        // The DB truth must never be resurrected back to 'sent' by the
        // lagging call.
        expect(dbStatus).toBe('superseded');
      });
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
