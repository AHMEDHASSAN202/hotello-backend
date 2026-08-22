import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TranslationMap } from '../requests/requests.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  CreateFnbLocationDto,
  UpdateFnbLocationDto,
} from './dto/fnb-location.dto';
import { FnbLocation } from './fnb-location.entity';
import { slugify } from './fnb-translations.util';

export interface FnbLocationView {
  id: string;
  key: string;
  names: TranslationMap;
  hasSpots: boolean;
  spotLabel: TranslationMap | null;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Epic 16, Story 16.3 — delivery locations. `key` is immutable once created
 * (printed QR stickers embed it — AC4): create derives it from the EN name
 * (deduped with numeric suffixes), update can never touch it. Deactivation
 * hides the location from guests while printed QRs keep resolving to a
 * graceful "choose your location" fallback client-side.
 */
@Injectable()
export class TenantFnbLocationsService {
  constructor(
    @InjectRepository(FnbLocation)
    private readonly locationsRepo: Repository<FnbLocation>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(hotelId: string): Promise<{ locations: FnbLocationView[] }> {
    const locations = await this.locationsRepo.find({ where: { hotelId } });
    return {
      locations: locations
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => this.toView(l)),
    };
  }

  async create(
    user: TenantUser,
    dto: CreateFnbLocationDto,
  ): Promise<FnbLocationView> {
    const key = await this.uniqueKey(user.hotelId, dto.nameEn);
    const location = await this.locationsRepo.save(
      this.locationsRepo.create({
        hotelId: user.hotelId,
        key,
        names: { en: dto.nameEn.trim(), ar: dto.nameAr.trim() },
        hasSpots: dto.hasSpots ?? false,
        spotLabel: this.spotLabelFrom(dto, null),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
    await this.audit(user, 'fnb_location.created', location.id, {
      created: { from: null, to: { key, nameEn: location.names.en } },
    });
    return this.toView(location);
  }

  async update(
    user: TenantUser,
    id: string,
    dto: UpdateFnbLocationDto,
  ): Promise<FnbLocationView> {
    const location = await this.findLocation(user.hotelId, id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (dto.nameEn !== undefined || dto.nameAr !== undefined) {
      const next: TranslationMap = {
        en: (dto.nameEn ?? location.names.en ?? '').trim(),
        ar: (dto.nameAr ?? location.names.ar ?? '').trim(),
      };
      if (JSON.stringify(next) !== JSON.stringify(location.names)) {
        // AC4 — rename changes display names only; `key` stays put.
        diff.names = { from: location.names, to: next };
        location.names = next;
      }
    }
    if (dto.hasSpots !== undefined && dto.hasSpots !== location.hasSpots) {
      diff.hasSpots = { from: location.hasSpots, to: dto.hasSpots };
      location.hasSpots = dto.hasSpots;
    }
    if (dto.spotLabelEn !== undefined || dto.spotLabelAr !== undefined) {
      const next = this.spotLabelFrom(dto, location.spotLabel);
      if (JSON.stringify(next) !== JSON.stringify(location.spotLabel)) {
        diff.spotLabel = { from: location.spotLabel, to: next };
        location.spotLabel = next;
      }
    }
    if (dto.isActive !== undefined && dto.isActive !== location.isActive) {
      diff.isActive = { from: location.isActive, to: dto.isActive };
      location.isActive = dto.isActive;
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== location.sortOrder) {
      diff.sortOrder = { from: location.sortOrder, to: dto.sortOrder };
      location.sortOrder = dto.sortOrder;
    }

    if (Object.keys(diff).length > 0) {
      await this.locationsRepo.save(location);
      await this.audit(user, 'fnb_location.updated', location.id, diff);
    }
    return this.toView(location);
  }

  /** Cross-tenant chokepoint — 404, never 403. */
  async findLocation(hotelId: string, id: string): Promise<FnbLocation> {
    const location = await this.locationsRepo.findOne({
      where: { id, hotelId },
    });
    if (!location) {
      throw new NotFoundException({
        code: 'FNB_LOCATION_NOT_FOUND',
        message: 'Location not found',
      });
    }
    return location;
  }

  private async uniqueKey(hotelId: string, nameEn: string): Promise<string> {
    const base = slugify(nameEn) || 'location';
    const existing = await this.locationsRepo.find({
      where: { hotelId },
      select: ['key'],
    });
    const used = new Set(existing.map((l) => l.key));
    let key = base;
    for (let i = 2; used.has(key); i += 1) key = `${base}-${i}`;
    return key;
  }

  private spotLabelFrom(
    dto: { spotLabelEn?: string; spotLabelAr?: string },
    existing: TranslationMap | null,
  ): TranslationMap | null {
    const label: TranslationMap = { ...(existing ?? {}) };
    if (dto.spotLabelEn !== undefined) {
      if (dto.spotLabelEn.trim()) label.en = dto.spotLabelEn.trim();
      else delete label.en;
    }
    if (dto.spotLabelAr !== undefined) {
      if (dto.spotLabelAr.trim()) label.ar = dto.spotLabelAr.trim();
      else delete label.ar;
    }
    return Object.keys(label).length ? label : null;
  }

  toView(location: FnbLocation): FnbLocationView {
    return {
      id: location.id,
      key: location.key,
      names: location.names,
      hasSpots: location.hasSpots,
      spotLabel: location.spotLabel,
      isActive: location.isActive,
      sortOrder: location.sortOrder,
    };
  }

  private async audit(
    user: TenantUser,
    action: string,
    entityId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'fnb_location',
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
