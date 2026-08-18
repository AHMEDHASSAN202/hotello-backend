import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, Not, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { DEFAULT_ROOM_TYPES } from './default-room-types';
import { Room } from './room.entity';
import { RoomType } from './room-type.entity';

/** A room type plus the count of rooms (any status) referencing it (Story 11.1). */
export interface RoomTypeWithCount extends RoomType {
  roomsCount: number;
}

@Injectable()
export class RoomTypesService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomTypesRepo: Repository<RoomType>,
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Story 11.1 AC2 — seed the default room types (Standard/Deluxe/Suite) for a
   * hotel. Idempotent: find-or-create by (hotelId, nameEn), so it is safe to
   * run on onboarding, from the seed script, and as a backfill for existing
   * hotels. Accepts an optional EntityManager so it can join the onboarding
   * transaction (mirrors TenantRolesService.seedDefaultRoles).
   */
  async seedDefaultRoomTypes(
    hotelId: string,
    manager?: EntityManager,
  ): Promise<RoomType[]> {
    const repo = manager ? manager.getRepository(RoomType) : this.roomTypesRepo;
    const result: RoomType[] = [];
    for (const def of DEFAULT_ROOM_TYPES) {
      const existing = await repo.findOne({
        where: { hotelId, nameEn: def.nameEn },
      });
      if (existing) {
        result.push(existing);
        continue;
      }
      result.push(await repo.save(repo.create({ hotelId, ...def })));
    }
    return result;
  }

  /**
   * Story 11.1 — the room-types management list, each with the count of rooms
   * (any status) referencing it, so the UI can explain why deactivation is
   * blocked before the hotel even tries. `includeInactive` toggles whether
   * deactivated types are included (management screen) or hidden (pickers).
   */
  async listTypes(
    hotelId: string,
    includeInactive: boolean,
  ): Promise<RoomTypeWithCount[]> {
    const types = await this.roomTypesRepo.find({
      where: includeInactive ? { hotelId } : { hotelId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(
      types.map(async (type) => ({
        ...type,
        roomsCount: await this.roomsRepo.count({
          where: { hotelId, roomTypeId: type.id },
        }),
      })),
    );
  }

  /**
   * Story 9.3/9.4-equivalent for room types — resolve a type within the
   * hotel. Cross-tenant or unknown ids return 404 (never confirm another
   * hotel's room types exist).
   */
  async findTypeInHotel(hotelId: string, id: string): Promise<RoomType> {
    const type = await this.roomTypesRepo.findOne({ where: { id, hotelId } });
    if (!type) {
      throw new NotFoundException({
        code: 'ROOM_TYPE_NOT_FOUND',
        message: 'Room type not found',
      });
    }
    return type;
  }

  /** Story 11.1 AC1 — create a custom room type. */
  async createType(actor: TenantUser, dto: CreateRoomTypeDto): Promise<RoomType> {
    await this.assertNameAvailable(actor.hotelId, dto.nameEn, dto.nameAr);

    const type = await this.roomTypesRepo.save(
      this.roomTypesRepo.create({
        hotelId: actor.hotelId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        descriptionEn: dto.descriptionEn ?? null,
        descriptionAr: dto.descriptionAr ?? null,
      }),
    );

    await this.auditLogs.log({
      action: 'room_type.created',
      entityType: 'room_type',
      entityId: type.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        nameEn: type.nameEn,
        nameAr: type.nameAr,
      },
    });

    return type;
  }

  /**
   * Story 11.1 AC1/AC3 — edit a room type's fields and/or `isActive`.
   * Deactivation (`isActive: false`) is guarded: a type with rooms assigned
   * (any status) cannot be deactivated until rooms are reassigned.
   */
  async updateType(
    actor: TenantUser,
    id: string,
    dto: UpdateRoomTypeDto,
  ): Promise<RoomType> {
    const type = await this.findTypeInHotel(actor.hotelId, id);

    if (dto.nameEn || dto.nameAr) {
      await this.assertNameAvailable(
        actor.hotelId,
        dto.nameEn ?? type.nameEn,
        dto.nameAr ?? type.nameAr,
        type.id,
      );
    }

    if (dto.isActive === false) {
      const roomsCount = await this.roomsRepo.count({
        where: { hotelId: actor.hotelId, roomTypeId: type.id },
      });
      if (roomsCount > 0) {
        throw new ConflictException({
          code: 'ROOM_TYPE_IN_USE',
          message: `Room type is assigned to ${roomsCount} room(s)`,
          roomsCount,
        });
      }
    }

    const before = {
      nameEn: type.nameEn,
      nameAr: type.nameAr,
      descriptionEn: type.descriptionEn,
      descriptionAr: type.descriptionAr,
      isActive: type.isActive,
    };

    if (dto.nameEn !== undefined) type.nameEn = dto.nameEn;
    if (dto.nameAr !== undefined) type.nameAr = dto.nameAr;
    if (dto.descriptionEn !== undefined) type.descriptionEn = dto.descriptionEn;
    if (dto.descriptionAr !== undefined) type.descriptionAr = dto.descriptionAr;
    if (dto.isActive !== undefined) type.isActive = dto.isActive;

    const saved = await this.roomTypesRepo.save(type);

    await this.auditLogs.log({
      action: 'room_type.updated',
      entityType: 'room_type',
      entityId: saved.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        before,
        after: {
          nameEn: saved.nameEn,
          nameAr: saved.nameAr,
          descriptionEn: saved.descriptionEn,
          descriptionAr: saved.descriptionAr,
          isActive: saved.isActive,
        },
      },
    });

    return saved;
  }

  /**
   * Story 11.1 AC1 — room type names are unique within a hotel per language.
   * Checked on both create and rename paths; reports which field clashed so
   * the UI can point at it precisely.
   */
  private async assertNameAvailable(
    hotelId: string,
    nameEn: string,
    nameAr: string,
    excludeId?: string,
  ): Promise<void> {
    const clashEn = await this.roomTypesRepo.findOne({
      where: excludeId
        ? { hotelId, nameEn: ILike(nameEn), id: Not(excludeId) }
        : { hotelId, nameEn: ILike(nameEn) },
    });
    if (clashEn) {
      throw new ConflictException({
        code: 'ROOM_TYPE_NAME_TAKEN',
        message: 'A room type with this English name already exists',
        field: 'nameEn',
      });
    }

    const clashAr = await this.roomTypesRepo.findOne({
      where: excludeId
        ? { hotelId, nameAr: ILike(nameAr), id: Not(excludeId) }
        : { hotelId, nameAr: ILike(nameAr) },
    });
    if (clashAr) {
      throw new ConflictException({
        code: 'ROOM_TYPE_NAME_TAKEN',
        message: 'A room type with this Arabic name already exists',
        field: 'nameAr',
      });
    }
  }
}
