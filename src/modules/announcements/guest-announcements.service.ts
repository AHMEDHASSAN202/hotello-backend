import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { localizeField } from '../requests/requests.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { naiveUtc } from '../tenant-stays/stay-time';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { Announcement } from './announcement.entity';
import { AnnouncementRead } from './announcement-read.entity';
import {
  hotelLocalStamp,
  isVisibleToStay,
} from './announcement-visibility';
import {
  GuestAnnouncementDelta,
  GuestAnnouncementView,
  GuestAnnouncementsFeed,
} from './announcement-views';
import { ListGuestAnnouncementsQueryDto } from './dto/announcements.dto';

/**
 * Epic 19, Story 19.4 — the guest inbox feed. Rides the Epic 15/16 delta
 * shape (`?updatedSince` = the previous response's serverTime) with one
 * addition: rows that changed but are no longer visible come back as
 * `{ id, active: false }` tombstones so retract/expire removes them from the
 * client (19.2 AC2). `unreadCount` rides every response — the bell badge
 * needs no second polling loop (spec note 3). Drafts/scheduled rows never
 * leave the tenant side.
 */
@Injectable()
export class GuestAnnouncementsService {
  constructor(
    @InjectRepository(Announcement)
    private readonly repo: Repository<Announcement>,
    @InjectRepository(AnnouncementRead)
    private readonly readsRepo: Repository<AnnouncementRead>,
    @InjectRepository(HotelInfoEntry)
    private readonly infoRepo: Repository<HotelInfoEntry>,
    private readonly access: TenantAccessService,
  ) {}

  async listForStay(
    stay: Stay,
    query: ListGuestAnnouncementsQueryDto,
  ): Promise<GuestAnnouncementsFeed> {
    await this.assertAvailable(stay.hotelId);
    const nowLocal = hotelLocalStamp(stay.hotel.timezone, new Date());

    // The full candidate set is always needed: unreadCount covers the whole
    // visible inbox even when `data` is a narrow delta.
    const candidates = await this.repo.find({
      where: {
        hotelId: stay.hotelId,
        status: In(['live', 'retracted', 'expired']),
      },
    });
    const visible = candidates
      .filter((a) => isVisibleToStay(a, stay, nowLocal))
      .sort(byPriorityThenNewest);

    const reads = await this.readsRepo.find({ where: { stayId: stay.id } });
    const readAtById = new Map(
      reads.map((r) => [r.announcementId, r.readAt]),
    );
    const unreadCount = visible.filter((a) => !readAtById.has(a.id)).length;

    let data: GuestAnnouncementDelta[];
    if (query.updatedSince) {
      // House pattern: the cursor is compared in SQL via naiveUtc — naive
      // timestamp columns silently skew with JS Date params (Epic 16 bug).
      const changed = await this.repo.find({
        where: {
          hotelId: stay.hotelId,
          status: In(['live', 'retracted', 'expired']),
          updatedAt: MoreThan(naiveUtc(query.updatedSince)),
        },
      });
      const chips = await this.resolveChips(stay, changed);
      data = changed
        .sort(byPriorityThenNewest)
        .map((a) =>
          isVisibleToStay(a, stay, nowLocal)
            ? this.toView(a, stay, readAtById, chips)
            : { id: a.id, active: false as const },
        );
    } else {
      const chips = await this.resolveChips(stay, visible);
      data = visible.map((a) => this.toView(a, stay, readAtById, chips));
    }

    return { data, unreadCount, serverTime: new Date().toISOString() };
  }

  async markRead(stay: Stay, id: string): Promise<{ readAt: string }> {
    await this.assertAvailable(stay.hotelId);
    const row = await this.repo.findOne({
      where: { id, hotelId: stay.hotelId },
    });
    const nowLocal = hotelLocalStamp(stay.hotel.timezone, new Date());
    // Never confirm invisible content exists — 404, not 403 (repo law).
    if (!row || !isVisibleToStay(row, stay, nowLocal)) {
      throw new NotFoundException({
        code: 'ANNOUNCEMENT_NOT_FOUND',
        message: 'Announcement not found',
      });
    }

    const existing = await this.readsRepo.findOne({
      where: { announcementId: id, stayId: stay.id },
    });
    if (existing) return { readAt: existing.readAt.toISOString() };

    try {
      const saved = await this.readsRepo.save(
        this.readsRepo.create({ announcementId: id, stayId: stay.id }),
      );
      return { readAt: saved.readAt.toISOString() };
    } catch (err) {
      // Unique-violation race: another tab won — the read row exists now.
      if ((err as { code?: string }).code === '23505') {
        const raced = await this.readsRepo.findOne({
          where: { announcementId: id, stayId: stay.id },
        });
        if (raced) return { readAt: raced.readAt.toISOString() };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------

  /** Same manual gating as every guest service — guards no-op on @GuestScope. */
  private async assertAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('announcements')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'announcements',
      });
    }
  }

  /** Batch-resolve Hotel Info chips; dangling/inactive links become null. */
  private async resolveChips(
    stay: Stay,
    rows: Announcement[],
  ): Promise<Map<string, HotelInfoEntry>> {
    const ids = rows
      .map((a) => a.infoEntryId)
      .filter((id): id is string => Boolean(id));
    if (!ids.length) return new Map();
    const entries = await this.infoRepo.find({
      where: { id: In(ids), hotelId: stay.hotelId, isActive: true },
    });
    return new Map(entries.map((e) => [e.id, e]));
  }

  private toView(
    a: Announcement,
    stay: Stay,
    readAtById: Map<string, Date>,
    chips: Map<string, HotelInfoEntry>,
  ): GuestAnnouncementView {
    const entry = a.infoEntryId ? chips.get(a.infoEntryId) : undefined;
    const readAt = readAtById.get(a.id);
    return {
      id: a.id,
      title: localizeField(a.titles, stay.language),
      body: localizeField(a.bodies, stay.language),
      priority: a.priority,
      infoChip: entry
        ? {
            entryId: entry.id,
            section: entry.section,
            name: localizeField(entry.names, stay.language),
          }
        : null,
      publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
      readAt: readAt ? new Date(readAt).toISOString() : null,
      active: true,
    };
  }
}

/** Inbox order (19.4 AC2): "مهم" pinned, then newest first. */
function byPriorityThenNewest(a: Announcement, b: Announcement): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return bt - at;
}
