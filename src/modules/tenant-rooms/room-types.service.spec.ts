import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DEFAULT_ROOM_TYPES } from './default-room-types';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';
import { RoomTypesService } from './room-types.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';

const actor = { id: 'user-1', hotelId: 'hotel-1' } as TenantUser;

describe('RoomTypesService', () => {
  let service: RoomTypesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let roomsRepo: { count: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => ({ id: row.id ?? 'room-type-new', ...row })),
    };
    roomsRepo = { count: jest.fn().mockResolvedValue(0) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoomTypesService,
        { provide: getRepositoryToken(RoomType), useValue: repo },
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
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

  describe('listTypes (11.1)', () => {
    it('AC1 — returns active types with roomsCount by default', async () => {
      repo.find.mockResolvedValue([
        { id: 'rt-1', hotelId: 'hotel-1', nameEn: 'Standard', isActive: true },
      ]);
      roomsRepo.count.mockResolvedValue(3);

      const result = await service.listTypes('hotel-1', false);

      expect(repo.find).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', isActive: true },
        order: { createdAt: 'ASC' },
      });
      expect(roomsRepo.count).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', roomTypeId: 'rt-1' },
      });
      expect(result).toEqual([
        expect.objectContaining({ id: 'rt-1', roomsCount: 3 }),
      ]);
    });

    it('AC1 — includeInactive includes inactive types too', async () => {
      repo.find.mockResolvedValue([]);
      await service.listTypes('hotel-1', true);

      expect(repo.find).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('createType (11.1)', () => {
    const dto = {
      nameEn: 'Family',
      nameAr: 'عائلية',
      descriptionEn: 'Family room',
      descriptionAr: 'غرفة عائلية',
    };

    it('AC1 — creates with bilingual name and optional descriptions', async () => {
      const result = await service.createType(actor, dto);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: 'hotel-1',
          nameEn: 'Family',
          nameAr: 'عائلية',
          descriptionEn: 'Family room',
          descriptionAr: 'غرفة عائلية',
        }),
      );
      expect(result).toMatchObject({ nameEn: 'Family', hotelId: 'hotel-1' });
    });

    it('AC1 — duplicate nameEn in the same hotel → 409 ROOM_TYPE_NAME_TAKEN', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'existing', nameEn: 'Family' });

      await expect(service.createType(actor, dto)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ROOM_TYPE_NAME_TAKEN',
          field: 'nameEn',
        }),
      });
    });

    it('AC1 — duplicate nameAr in the same hotel → 409 ROOM_TYPE_NAME_TAKEN', async () => {
      repo.findOne
        .mockResolvedValueOnce(null) // nameEn check passes
        .mockResolvedValueOnce({ id: 'existing', nameAr: 'عائلية' }); // nameAr clash

      await expect(service.createType(actor, dto)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ROOM_TYPE_NAME_TAKEN',
          field: 'nameAr',
        }),
      });
    });

    it('AC1 — same name in ANOTHER hotel is allowed (isolation)', async () => {
      repo.findOne.mockResolvedValue(null); // this hotel's scoped lookup finds nothing

      await service.createType(actor, dto);

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: 'hotel-1' }),
        }),
      );
    });

    it('audits room_type.created', async () => {
      const result = await service.createType(actor, dto);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'room_type.created',
          entityType: 'room_type',
          entityId: result.id,
          actorId: 'user-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: 'hotel-1',
          }),
        }),
      );
    });
  });

  describe('updateType (11.1)', () => {
    const existing = {
      id: 'rt-1',
      hotelId: 'hotel-1',
      nameEn: 'Standard',
      nameAr: 'قياسية',
      descriptionEn: 'd',
      descriptionAr: 'د',
      isActive: true,
    };

    beforeEach(() => {
      repo.findOne.mockImplementation(async ({ where }) => {
        if (where.id === existing.id && where.hotelId === existing.hotelId) {
          return { ...existing };
        }
        return null;
      });
    });

    it('AC1 — edits names/descriptions with audit diff (room_type.updated)', async () => {
      const result = await service.updateType(actor, 'rt-1', {
        nameEn: 'Standard Plus',
      });

      expect(result.nameEn).toBe('Standard Plus');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'room_type.updated',
          entityType: 'room_type',
          entityId: 'rt-1',
          actorId: 'user-1',
          metadata: expect.objectContaining({
            actorType: 'tenant_user',
            hotelId: 'hotel-1',
            before: expect.objectContaining({ nameEn: 'Standard' }),
            after: expect.objectContaining({ nameEn: 'Standard Plus' }),
          }),
        }),
      );
    });

    it('AC3 — deactivation with rooms assigned → 409 ROOM_TYPE_IN_USE with { roomsCount }', async () => {
      roomsRepo.count.mockResolvedValue(5);

      await expect(
        service.updateType(actor, 'rt-1', { isActive: false }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ROOM_TYPE_IN_USE',
          roomsCount: 5,
        }),
      });
    });

    it('AC3 — deactivation with zero rooms succeeds', async () => {
      roomsRepo.count.mockResolvedValue(0);

      const result = await service.updateType(actor, 'rt-1', {
        isActive: false,
      });

      expect(result.isActive).toBe(false);
    });

    it('cross-tenant id → 404 ROOM_TYPE_NOT_FOUND', async () => {
      await expect(
        service.updateType(actor, 'other-hotels-id', { nameEn: 'X' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ROOM_TYPE_NOT_FOUND' }),
      });
    });
  });
});
