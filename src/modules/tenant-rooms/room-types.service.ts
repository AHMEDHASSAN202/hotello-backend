import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DEFAULT_ROOM_TYPES } from './default-room-types';
import { RoomType } from './room-type.entity';

@Injectable()
export class RoomTypesService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomTypesRepo: Repository<RoomType>,
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
}
