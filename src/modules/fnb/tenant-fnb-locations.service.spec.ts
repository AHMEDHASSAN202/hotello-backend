import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbLocation } from './fnb-location.entity';
import { TenantFnbLocationsService } from './tenant-fnb-locations.service';

const HOTEL_ID = 'hotel-1';
const actor = { id: 'user-1', hotelId: HOTEL_ID } as unknown as TenantUser;

const makeLocation = (o: Partial<FnbLocation> = {}): FnbLocation =>
  ({
    id: 'loc-1',
    hotelId: HOTEL_ID,
    key: 'pool',
    names: { en: 'Pool', ar: 'المسبح' },
    hasSpots: true,
    spotLabel: { en: 'Umbrella', ar: 'شمسية' },
    isActive: true,
    sortOrder: 0,
    ...o,
  }) as FnbLocation;

describe('TenantFnbLocationsService (16.3)', () => {
  let service: TenantFnbLocationsService;
  let repo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ id: 'loc-new', ...d })),
      save: jest.fn(async (l) => l),
    };
    auditLogs = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantFnbLocationsService,
        { provide: getRepositoryToken(FnbLocation), useValue: repo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(TenantFnbLocationsService);
  });

  describe('create (AC1)', () => {
    it('derives a kebab key from the EN name and stores bilingual names', async () => {
      const view = await service.create(actor, {
        nameEn: 'Beach Bar A',
        nameAr: 'بار الشاطئ أ',
        hasSpots: true,
        spotLabelEn: 'Umbrella',
        spotLabelAr: 'شمسية',
      } as never);
      expect(view.key).toEqual('beach-bar-a');
      expect(view.names).toEqual({ en: 'Beach Bar A', ar: 'بار الشاطئ أ' });
      expect(view.spotLabel).toEqual({ en: 'Umbrella', ar: 'شمسية' });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fnb_location.created' }),
      );
    });

    it('deduplicates colliding keys with numeric suffixes', async () => {
      repo.find.mockResolvedValue([
        makeLocation({ key: 'pool' }),
        makeLocation({ id: 'loc-2', key: 'pool-2' }),
      ]);
      const view = await service.create(actor, {
        nameEn: 'Pool',
        nameAr: 'المسبح',
      } as never);
      expect(view.key).toEqual('pool-3');
    });
  });

  describe('update (AC4 — key immutability)', () => {
    it('rename changes display names ONLY; the key never moves', async () => {
      repo.findOne.mockResolvedValue(makeLocation());
      const view = await service.update(actor, 'loc-1', {
        nameEn: 'Main Pool',
        nameAr: 'المسبح الرئيسي',
      } as never);
      expect(view.key).toEqual('pool');
      expect(view.names.en).toEqual('Main Pool');
      const saved = repo.save.mock.calls[0][0];
      expect(saved.key).toEqual('pool');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fnb_location.updated',
          metadata: expect.objectContaining({
            diff: expect.not.objectContaining({ key: expect.anything() }),
          }),
        }),
      );
    });

    it('deactivation flips isActive with a diff (QRs keep resolving)', async () => {
      repo.findOne.mockResolvedValue(makeLocation());
      await service.update(actor, 'loc-1', { isActive: false } as never);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            diff: { isActive: { from: true, to: false } },
          }),
        }),
      );
    });

    it('cross-tenant locations 404 (isolation)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update(actor, 'loc-x', { nameEn: 'X', nameAr: 'س' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'loc-x', hotelId: HOTEL_ID },
      });
    });
  });

  it('list returns hotel locations sorted by sortOrder', async () => {
    repo.find.mockResolvedValue([
      makeLocation({ id: 'b', sortOrder: 2, key: 'beach' }),
      makeLocation({ id: 'a', sortOrder: 1 }),
    ]);
    const { locations } = await service.list(HOTEL_ID);
    expect(locations.map((l) => l.id)).toEqual(['a', 'b']);
    expect(repo.find).toHaveBeenCalledWith({ where: { hotelId: HOTEL_ID } });
  });
});
