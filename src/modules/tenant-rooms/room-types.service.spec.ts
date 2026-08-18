import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DEFAULT_ROOM_TYPES } from './default-room-types';
import { RoomType } from './room-type.entity';
import { RoomTypesService } from './room-types.service';

describe('RoomTypesService', () => {
  let service: RoomTypesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: 'room-type-new', ...row })),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomTypesService,
        { provide: getRepositoryToken(RoomType), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(RoomTypesService);
  });

  describe('seedDefaultRoomTypes (11.1)', () => {
    it('AC2 — seeds Standard/Deluxe/Suite bilingual for a new hotel', async () => {
      repo.findOne.mockResolvedValue(null); // none exist yet
      await service.seedDefaultRoomTypes('hotel-1');

      expect(repo.save).toHaveBeenCalledTimes(DEFAULT_ROOM_TYPES.length);
      const saved = repo.save.mock.calls.map((c) => c[0]);

      expect(saved.map((r) => r.nameEn)).toEqual([
        'Standard',
        'Deluxe',
        'Suite',
      ]);
      const suite = saved.find((r) => r.nameEn === 'Suite');
      expect(suite).toMatchObject({
        hotelId: 'hotel-1',
        nameAr: 'جناح',
      });
    });

    it('AC2 — is idempotent: existing names are not re-created', async () => {
      repo.findOne.mockImplementation(async ({ where }) => ({
        id: 'existing',
        nameEn: where.nameEn,
      }));
      const result = await service.seedDefaultRoomTypes('hotel-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(result).toHaveLength(DEFAULT_ROOM_TYPES.length);
    });

    it('AC2 — joins the caller transaction when a manager is passed', async () => {
      const managerRepo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => d),
        save: jest.fn(async (r) => r),
      };
      const em = { getRepository: jest.fn(() => managerRepo) };

      await service.seedDefaultRoomTypes('hotel-1', em as never);

      expect(em.getRepository).toHaveBeenCalledWith(RoomType);
      expect(managerRepo.save).toHaveBeenCalledTimes(DEFAULT_ROOM_TYPES.length);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
