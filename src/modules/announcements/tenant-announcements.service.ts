import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { Announcement } from './announcement.entity';
import { AnnouncementRead } from './announcement-read.entity';
import {
  hotelLocalStamp,
  matchesAudience,
} from './announcement-visibility';
import {
  mergeBodies,
  mergeTitles,
  touchesBodies,
  touchesTitles,
} from './announcement-translations.util';
import {
  TenantAnnouncementView,
  toTenantView,
} from './announcement-views';
import { AnnouncementSource, AudienceFilter } from './announcements.constants';
import {
  AudienceFilterDto,
  CreateAnnouncementDto,
  PreviewAudienceDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

/**
 * Options only internal cross-module callers pass (Events' publish/cancel).
 * `dropUnresolvedStays` relaxes the stay-id validation from "all-or-400" to
 * "notify whoever is still here": a guest checking out between the caller's
 * own active-stay filter and `resolveAudience()`'s re-validation must not
 * cost the remaining residents their notice. The public
 * `POST /tenant/announcements` route never sets it — a manual audience with
 * a stale stay id still 400s, so the composer sees its mistake.
 */
export interface InternalCreateOptions {
  source?: AnnouncementSource;
  eventId?: string;
  dropUnresolvedStays?: boolean;
}

/**
 * Epic 19, Stories 19.1–19.3 — compose & target, publish/schedule/retract,
 * sent history + read stats. The audience is a FILTER (19.1 AC3): nothing is
 * snapshotted, so `matchesAudience` against *current* active stays answers
 * the recipient count and the stats denominator alike. All lookups filter
 * hotelId → cross-tenant is a 404 (repo law). Live announcements are never
 * editable (19.2 AC3) — retract and resend.
 */
@Injectable()
export class TenantAnnouncementsService {
  constructor(
    @InjectRepository(Announcement)
    private readonly repo: Repository<Announcement>,
    @InjectRepository(AnnouncementRead)
    private readonly readsRepo: Repository<AnnouncementRead>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(HotelInfoEntry)
    private readonly infoRepo: Repository<HotelInfoEntry>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(user: TenantUser): Promise<{ data: TenantAnnouncementView[] }> {
    const rows = await this.repo.find({
      where: { hotelId: user.hotelId },
      order: { createdAt: 'DESC' },
    });
    return { data: await this.toViews(user.hotelId, rows) };
  }

  async get(user: TenantUser, id: string): Promise<TenantAnnouncementView> {
    const row = await this.find(user, id);
    const [view] = await this.toViews(user.hotelId, [row]);
    return view;
  }

  async create(
    user: TenantUser,
    dto: CreateAnnouncementDto,
  ): Promise<TenantAnnouncementView>;
  async create(
    user: TenantUser,
    dto: CreateAnnouncementDto,
    internal: InternalCreateOptions,
  ): Promise<TenantAnnouncementView | null>;
  async create(
    user: TenantUser,
    dto: CreateAnnouncementDto,
    /**
     * 21.3 groundwork — set only by internal cross-module callers (Events'
     * publish/cancel, Task 6), never by the public `POST /tenant/announcements`
     * route: the field isn't on `CreateAnnouncementDto`, so a tenant user has
     * no way to self-badge a manual announcement as "auto · event".
     */
    internal?: InternalCreateOptions,
  ): Promise<TenantAnnouncementView | null> {
    const titles = mergeTitles(dto);
    const bodies = mergeBodies(dto);
    const audience = await this.resolveAudience(user.hotelId, dto.audience, {
      dropUnresolvedStays: internal?.dropUnresolvedStays,
    });
    if (audience === null) {
      // Every targeted stay went inactive between the caller's own check and
      // this one — there is nobody left to notify, so creating an
      // unreachable row would be noise. Not an error: the caller's business
      // operation (the event cancel) already committed.
      return null;
    }
    const infoEntryId = await this.resolveInfoEntry(
      user.hotelId,
      dto.infoEntryId ?? null,
    );
    const nowLocal = await this.nowLocal(user.hotelId);
    const timing = this.resolveTiming(dto, nowLocal);

    const row = this.repo.create({
      hotelId: user.hotelId,
      titles,
      bodies,
      infoEntryId,
      priority: dto.priority ?? false,
      audience,
      createdById: user.id,
      source: internal?.source ?? null,
      eventId: internal?.eventId ?? null,
      ...timing,
    });
    const saved = await this.repo.save(row);

    if (saved.status === 'live') {
      await this.audit(user, saved.id, 'announcement.published');
    } else {
      await this.audit(user, saved.id, 'announcement.created');
      if (saved.status === 'scheduled') {
        await this.audit(user, saved.id, 'announcement.scheduled', {
          publishAtLocal: saved.publishAtLocal,
        });
      }
    }
    const [view] = await this.toViews(user.hotelId, [saved]);
    return view;
  }

  async update(
    user: TenantUser,
    id: string,
    dto: UpdateAnnouncementDto,
  ): Promise<TenantAnnouncementView> {
    const row = await this.find(user, id);
    if (row.status !== 'draft' && row.status !== 'scheduled') {
      // 19.2 AC3 — guests may have read version 1; retract and resend.
      throw new ConflictException({
        code: 'ANNOUNCEMENT_NOT_EDITABLE',
        message: 'Live announcements cannot be edited — retract and resend',
        status: row.status,
      });
    }

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const track = (key: string, from: unknown, to: unknown): void => {
      if (JSON.stringify(from) !== JSON.stringify(to)) diff[key] = { from, to };
    };

    if (touchesTitles(dto)) {
      const next = mergeTitles(dto, row.titles);
      track('titles', row.titles, next);
      row.titles = next;
    }
    if (touchesBodies(dto)) {
      const next = mergeBodies(dto, row.bodies);
      track('bodies', row.bodies, next);
      row.bodies = next;
    }
    if (dto.audience !== undefined) {
      const next = await this.resolveAudience(user.hotelId, dto.audience);
      track('audience', row.audience, next);
      row.audience = next;
    }
    if (dto.infoEntryId !== undefined) {
      const next = await this.resolveInfoEntry(user.hotelId, dto.infoEntryId);
      track('infoEntryId', row.infoEntryId, next);
      row.infoEntryId = next;
    }
    if (dto.priority !== undefined) {
      track('priority', row.priority, dto.priority);
      row.priority = dto.priority;
    }

    const nowLocal = await this.nowLocal(user.hotelId);
    if (dto.publishAtLocal !== undefined) {
      if (row.status === 'scheduled' && dto.publishAtLocal <= nowLocal) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_SCHEDULE_IN_PAST',
          message: 'The scheduled time is in the hotel-local past',
        });
      }
      track('publishAtLocal', row.publishAtLocal, dto.publishAtLocal);
      row.publishAtLocal = dto.publishAtLocal;
    }
    if (dto.activeUntilLocal !== undefined) {
      const floor = row.publishAtLocal ?? nowLocal;
      if (dto.activeUntilLocal !== null && dto.activeUntilLocal <= floor) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_WINDOW_INVALID',
          message: 'active-until must be after the publish time',
        });
      }
      track('activeUntilLocal', row.activeUntilLocal, dto.activeUntilLocal);
      row.activeUntilLocal = dto.activeUntilLocal;
    }

    const saved = await this.repo.save(row);
    await this.audit(user, saved.id, 'announcement.updated', { diff });
    const [view] = await this.toViews(user.hotelId, [saved]);
    return view;
  }

  async sendNow(user: TenantUser, id: string): Promise<TenantAnnouncementView> {
    const row = await this.find(user, id);
    this.assertStatus(row, ['draft', 'scheduled']);
    const nowLocal = await this.nowLocal(user.hotelId);
    if (row.activeUntilLocal && row.activeUntilLocal <= nowLocal) {
      throw new BadRequestException({
        code: 'ANNOUNCEMENT_WINDOW_INVALID',
        message: 'active-until must be after the publish time',
      });
    }
    row.status = 'live';
    row.publishedAt = new Date();
    row.publishAtLocal = null;
    const saved = await this.repo.save(row);
    await this.audit(user, saved.id, 'announcement.published');
    const [view] = await this.toViews(user.hotelId, [saved]);
    return view;
  }

  async cancelSchedule(
    user: TenantUser,
    id: string,
  ): Promise<TenantAnnouncementView> {
    const row = await this.find(user, id);
    this.assertStatus(row, ['scheduled']);
    row.status = 'draft';
    row.publishAtLocal = null;
    const saved = await this.repo.save(row);
    await this.audit(user, saved.id, 'announcement.schedule_canceled');
    const [view] = await this.toViews(user.hotelId, [saved]);
    return view;
  }

  async retract(user: TenantUser, id: string): Promise<TenantAnnouncementView> {
    const row = await this.find(user, id);
    this.assertStatus(row, ['live']);
    row.status = 'retracted';
    row.retractedAt = new Date();
    row.retractedById = user.id;
    const saved = await this.repo.save(row);
    // 19.2 AC2 — disappears from all guests immediately; read stats preserved.
    await this.audit(user, saved.id, 'announcement.retracted');
    const [view] = await this.toViews(user.hotelId, [saved]);
    return view;
  }

  /** 19.1 AC2 — "سيصل إلى 62 ضيفًا حاليًا" (labeled "currently", AC3). */
  async previewAudience(
    user: TenantUser,
    dto: PreviewAudienceDto,
  ): Promise<{ count: number }> {
    const audience = this.normalizeAudience(dto.audience);
    const stays = await this.activeStays(user.hotelId);
    return { count: stays.filter((s) => matchesAudience(audience, s)).length };
  }

  // ------------------------------------------------------------------

  private async find(user: TenantUser, id: string): Promise<Announcement> {
    const row = await this.repo.findOne({
      where: { id, hotelId: user.hotelId },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ANNOUNCEMENT_NOT_FOUND',
        message: 'Announcement not found',
      });
    }
    return row;
  }

  private assertStatus(row: Announcement, allowed: string[]): void {
    if (!allowed.includes(row.status)) {
      throw new ConflictException({
        code: 'ANNOUNCEMENT_INVALID_STATE',
        message: `Announcement is ${row.status}`,
        status: row.status,
      });
    }
  }

  private async nowLocal(hotelId: string): Promise<string> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    return hotelLocalStamp(hotel?.timezone ?? 'UTC', new Date());
  }

  private resolveTiming(
    dto: CreateAnnouncementDto,
    nowLocal: string,
  ): Partial<Announcement> {
    const activeUntilLocal = dto.activeUntilLocal ?? null;
    if (dto.action === 'send') {
      if (activeUntilLocal && activeUntilLocal <= nowLocal) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_WINDOW_INVALID',
          message: 'active-until must be after the publish time',
        });
      }
      return {
        status: 'live',
        publishedAt: new Date(),
        publishAtLocal: null,
        activeUntilLocal,
      };
    }
    if (dto.action === 'schedule') {
      if (!dto.publishAtLocal) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_SCHEDULE_REQUIRED',
          message: 'A hotel-local publish time is required to schedule',
        });
      }
      if (dto.publishAtLocal <= nowLocal) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_SCHEDULE_IN_PAST',
          message: 'The scheduled time is in the hotel-local past',
        });
      }
      if (activeUntilLocal && activeUntilLocal <= dto.publishAtLocal) {
        throw new BadRequestException({
          code: 'ANNOUNCEMENT_WINDOW_INVALID',
          message: 'active-until must be after the publish time',
        });
      }
      return {
        status: 'scheduled',
        publishAtLocal: dto.publishAtLocal,
        activeUntilLocal,
      };
    }
    return {
      status: 'draft',
      publishAtLocal: dto.publishAtLocal ?? null,
      activeUntilLocal,
    };
  }

  private normalizeAudience(dto?: AudienceFilterDto): AudienceFilter {
    const filter: AudienceFilter = {};
    if (dto?.stayTypes?.length) filter.stayTypes = dto.stayTypes;
    if (dto?.floors?.length) filter.floors = dto.floors;
    if (dto?.roomIds?.length) filter.roomIds = dto.roomIds;
    if (dto?.stayId) filter.stayId = dto.stayId;
    if (dto?.stayIds?.length) filter.stayIds = dto.stayIds;
    const isSingleGuestTargeting = Boolean(filter.stayId || filter.stayIds);
    const combinesOtherDimensions = Boolean(
      filter.stayTypes || filter.floors || filter.roomIds,
    );
    if (
      isSingleGuestTargeting &&
      (combinesOtherDimensions || (filter.stayId && filter.stayIds))
    ) {
      throw new BadRequestException({
        code: 'ANNOUNCEMENT_AUDIENCE_INVALID',
        message: 'A single-guest audience cannot combine other filters',
      });
    }
    return filter;
  }

  private async resolveAudience(
    hotelId: string,
    dto?: AudienceFilterDto,
  ): Promise<AudienceFilter>;
  private async resolveAudience(
    hotelId: string,
    dto: AudienceFilterDto | undefined,
    opts: { dropUnresolvedStays?: boolean },
  ): Promise<AudienceFilter | null>;
  /**
   * Strict by default: every targeted stay id must resolve to an active stay
   * of this hotel or the whole call 400s (the manual/public path — a typo in
   * the audience must be visible). With `dropUnresolvedStays`, unresolvable
   * ids are filtered out instead, and `null` is returned when that leaves
   * nobody — never an empty `stayIds`, which would silently mean "everyone".
   */
  private async resolveAudience(
    hotelId: string,
    dto?: AudienceFilterDto,
    opts: { dropUnresolvedStays?: boolean } = {},
  ): Promise<AudienceFilter | null> {
    const filter = this.normalizeAudience(dto);
    const drop = opts.dropUnresolvedStays === true;

    if (filter.stayId) {
      const stay = await this.staysRepo.findOne({
        where: { id: filter.stayId, hotelId, status: 'active' },
      });
      if (!stay) {
        if (!drop) {
          throw new BadRequestException({
            code: 'ANNOUNCEMENT_STAY_NOT_FOUND',
            message: 'The targeted guest stay was not found or is not active',
          });
        }
        return null;
      }
    }
    if (filter.stayIds?.length) {
      const stays = await this.staysRepo.find({
        where: { id: In(filter.stayIds), hotelId, status: 'active' },
      });
      if (stays.length !== filter.stayIds.length) {
        if (!drop) {
          throw new BadRequestException({
            code: 'ANNOUNCEMENT_STAY_NOT_FOUND',
            message:
              'One or more targeted guest stays were not found or are not active',
          });
        }
        if (stays.length === 0) return null;
        // Keep the caller's ordering, minus whoever left.
        const stillActive = new Set(stays.map((s) => s.id));
        filter.stayIds = filter.stayIds.filter((id) => stillActive.has(id));
      }
    }
    return filter;
  }

  private async resolveInfoEntry(
    hotelId: string,
    infoEntryId: string | null,
  ): Promise<string | null> {
    if (!infoEntryId) return null;
    const entry = await this.infoRepo.findOne({
      where: { id: infoEntryId, hotelId, isActive: true },
    });
    if (!entry) {
      throw new BadRequestException({
        code: 'ANNOUNCEMENT_INFO_ENTRY_NOT_FOUND',
        message: 'The linked Hotel Info entry was not found',
      });
    }
    return infoEntryId;
  }

  private async activeStays(hotelId: string): Promise<Stay[]> {
    return this.staysRepo.find({
      where: { hotelId, status: 'active' },
      relations: ['room'],
    });
  }

  private async readCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows: Array<{ announcementId: string; count: string }> =
      await this.readsRepo
        .createQueryBuilder('r')
        .select('r.announcementId', 'announcementId')
        .addSelect('COUNT(*)', 'count')
        .where('r.announcementId IN (:...ids)', { ids })
        .groupBy('r.announcementId')
        .getRawMany();
    return new Map(rows.map((r) => [r.announcementId, Number(r.count)]));
  }

  /** Shared view assembly: one stays query + one grouped reads query. */
  private async toViews(
    hotelId: string,
    rows: Announcement[],
  ): Promise<TenantAnnouncementView[]> {
    if (!rows.length) return [];
    const [stays, reads] = await Promise.all([
      this.activeStays(hotelId),
      this.readCounts(rows.map((r) => r.id)),
    ]);

    const stayIds = rows
      .map((r) => r.audience?.stayId)
      .filter((id): id is string => Boolean(id));
    const targetStays = stayIds.length
      ? await this.staysRepo.find({
          where: { id: In(stayIds), hotelId },
          relations: ['room'],
        })
      : [];
    const targetById = new Map(targetStays.map((s) => [s.id, s]));

    return rows.map((row) => {
      const target = row.audience?.stayId
        ? (targetById.get(row.audience.stayId) ?? null)
        : null;
      return toTenantView(row, {
        reads: reads.get(row.id) ?? 0,
        audienceNow: stays.filter((s) => matchesAudience(row.audience, s))
          .length,
        audienceStay: target
          ? {
              guestName: target.guestName,
              roomNumber: target.room?.roomNumber ?? '',
            }
          : null,
      });
    });
  }

  private async audit(
    user: TenantUser,
    entityId: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'announcement',
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, ...metadata },
    });
  }
}
