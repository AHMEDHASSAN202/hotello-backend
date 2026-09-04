import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { PushSubscription } from './push-subscription.entity';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { SubscribePushDto } from './dto/push.dto';

const makeStay = (o: Partial<Stay> = {}): Stay =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    ...o,
  }) as Stay;

const makeSubscribeDto = (o: Partial<SubscribePushDto> = {}): SubscribePushDto =>
  ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    ...o,
  }) as SubscribePushDto;

describe('PushSubscriptionsService (23.1 AC1, 23.2 AC4)', () => {
  let service: PushSubscriptionsService;
  let repo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((partial) => ({ ...partial }) as PushSubscription),
      save: jest.fn(async (entity) => entity),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushSubscriptionsService,
        { provide: getRepositoryToken(PushSubscription), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(PushSubscriptionsService);
  });

  describe('upsert', () => {
    it('creates a new subscription bound to the stay', async () => {
      const stay = makeStay({ id: 'stay-1', hotelId: 'hotel-1' });
      const dto = makeSubscribeDto({ deviceHint: 'android' });

      await service.upsert(stay, dto);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { endpoint: dto.endpoint },
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        endpoint: dto.endpoint,
        hotelId: 'hotel-1',
        stayId: 'stay-1',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        deviceHint: 'android',
        failureCount: 0,
      });
    });

    it('is idempotent for an existing endpoint (updates keys, no duplicate row)', async () => {
      const existing: PushSubscription = {
        id: 'sub-1',
        hotelId: 'hotel-1',
        stayId: 'stay-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        p256dh: 'old-p256dh',
        auth: 'old-auth',
        deviceHint: 'android',
        failureCount: 3,
        lastSuccessAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      repo.findOne.mockResolvedValue(existing);
      const stay = makeStay({ id: 'stay-1', hotelId: 'hotel-1' });
      const dto = makeSubscribeDto({ keys: { p256dh: 'new-p256dh', auth: 'new-auth' } });

      await service.upsert(stay, dto);

      // No new row created — the existing entity is reused/saved, never repo.create().
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.id).toBe('sub-1');
      expect(saved.p256dh).toBe('new-p256dh');
      expect(saved.auth).toBe('new-auth');
      // failureCount resets on any successful re-subscribe.
      expect(saved.failureCount).toBe(0);
    });

    it('re-binds an endpoint from a previous stay to the current stay and resets failureCount', async () => {
      const existing: PushSubscription = {
        id: 'sub-1',
        hotelId: 'hotel-1',
        stayId: 'stay-OLD',
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        p256dh: 'old-p256dh',
        auth: 'old-auth',
        deviceHint: 'android',
        failureCount: 5,
        lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      repo.findOne.mockResolvedValue(existing);
      // Same device (same endpoint), but a *new* guest / new stay now holds it.
      const newStay = makeStay({ id: 'stay-NEW', hotelId: 'hotel-1' });
      const dto = makeSubscribeDto();

      await service.upsert(newStay, dto);

      const saved = repo.save.mock.calls[0][0];
      expect(saved.stayId).toBe('stay-NEW');
      expect(saved.failureCount).toBe(0);
    });

    it('preserves the existing deviceHint when the dto omits it', async () => {
      const existing: PushSubscription = {
        id: 'sub-1',
        hotelId: 'hotel-1',
        stayId: 'stay-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        p256dh: 'old-p256dh',
        auth: 'old-auth',
        deviceHint: 'ios-pwa',
        failureCount: 0,
        lastSuccessAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      repo.findOne.mockResolvedValue(existing);
      const stay = makeStay();
      const dto = makeSubscribeDto({ deviceHint: undefined });

      await service.upsert(stay, dto);

      expect(repo.save.mock.calls[0][0].deviceHint).toBe('ios-pwa');
    });
  });

  describe('remove (cross-stay isolation)', () => {
    /**
     * Simulates TypeORM's `delete(criteria)` against an in-memory store so
     * the assertion is on real deletion behaviour, not just on how the mock
     * was called — a service that only filtered by `endpoint` (forgetting
     * `stayId`) would fail this test by deleting another stay's row.
     */
    const makeFakeDeleteRepo = (rows: PushSubscription[]) => {
      const store = [...rows];
      return {
        delete: jest.fn(async (criteria: Partial<PushSubscription>) => {
          const before = store.length;
          for (let i = store.length - 1; i >= 0; i -= 1) {
            const row = store[i];
            const matches = Object.entries(criteria).every(
              ([key, value]) => (row as any)[key] === value,
            );
            if (matches) store.splice(i, 1);
          }
          return { affected: before - store.length };
        }),
        _store: store,
      };
    };

    it("deletes only the caller-stay's own subscription; another stay's row with the same-ish endpoint is untouched", async () => {
      const otherStaysRow: PushSubscription = {
        id: 'sub-other',
        hotelId: 'hotel-1',
        stayId: 'stay-OTHER',
        endpoint: 'https://fcm.googleapis.com/fcm/send/shared-device',
        p256dh: 'p',
        auth: 'a',
        deviceHint: null,
        failureCount: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const fakeRepo = makeFakeDeleteRepo([otherStaysRow]);

      const moduleRef = await Test.createTestingModule({
        providers: [
          PushSubscriptionsService,
          { provide: getRepositoryToken(PushSubscription), useValue: fakeRepo },
        ],
      }).compile();
      const isolatedService = moduleRef.get(PushSubscriptionsService);

      const callerStay = makeStay({ id: 'stay-CALLER', hotelId: 'hotel-1' });

      // Caller tries to unsubscribe an endpoint that actually belongs to a
      // different stay. It must not be deleted.
      await isolatedService.remove(callerStay, otherStaysRow.endpoint);

      expect(fakeRepo._store).toHaveLength(1);
      expect(fakeRepo._store[0].id).toBe('sub-other');
      // The delete call itself must have scoped by stayId (not endpoint alone).
      expect(fakeRepo.delete).toHaveBeenCalledWith(
        expect.objectContaining({ stayId: 'stay-CALLER' }),
      );
    });

    it("deletes the caller's own subscription for that endpoint", async () => {
      const ownRow: PushSubscription = {
        id: 'sub-mine',
        hotelId: 'hotel-1',
        stayId: 'stay-CALLER',
        endpoint: 'https://fcm.googleapis.com/fcm/send/my-device',
        p256dh: 'p',
        auth: 'a',
        deviceHint: null,
        failureCount: 0,
        lastSuccessAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const fakeRepo = makeFakeDeleteRepo([ownRow]);

      const moduleRef = await Test.createTestingModule({
        providers: [
          PushSubscriptionsService,
          { provide: getRepositoryToken(PushSubscription), useValue: fakeRepo },
        ],
      }).compile();
      const isolatedService = moduleRef.get(PushSubscriptionsService);

      const callerStay = makeStay({ id: 'stay-CALLER', hotelId: 'hotel-1' });
      await isolatedService.remove(callerStay, ownRow.endpoint);

      expect(fakeRepo._store).toHaveLength(0);
    });
  });

  describe('findByStayIds', () => {
    it('returns all devices for the given stays (family-phones)', async () => {
      const rows = [
        { id: 'sub-1', stayId: 'stay-A' } as PushSubscription,
        { id: 'sub-2', stayId: 'stay-A' } as PushSubscription,
        { id: 'sub-3', stayId: 'stay-B' } as PushSubscription,
      ];
      repo.find.mockResolvedValue(rows);

      const result = await service.findByStayIds(['stay-A', 'stay-B']);

      expect(result).toBe(rows);
      expect(repo.find).toHaveBeenCalledWith({
        where: { stayId: expect.anything() },
      });
    });

    it('returns an empty array without querying when given no stay ids', async () => {
      const result = await service.findByStayIds([]);

      expect(result).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
