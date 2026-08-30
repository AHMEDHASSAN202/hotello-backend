import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAnnouncementDto } from '../announcements/dto/announcements.dto';
import { TenantAnnouncementsService } from '../announcements/tenant-announcements.service';
import { HotelInfoEntry } from '../hotel-info/hotel-info-entry.entity';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { StayType } from '../tenant-stays/stays.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CancelEventDto } from './dto/cancel-event.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListTenantEventsQueryDto } from './dto/list-tenant-events-query.dto';
import { PublishEventDto } from './dto/publish-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  composeCancelAnnouncement,
  composePublishAnnouncement,
} from './event-announce.util';
import { EventBooking } from './event-booking.entity';
import { Event } from './event.entity';
import { hotelLocalStamp } from './event-time';
import { EventStatus } from './events.constants';

/**
 * Full management view — create/update/get all return this shape. Photo
 * upload/removal live in `EventPhotoService`, so `photoKeys` isn't writable
 * from here (Story 21.2/21.3 split).
 */
export interface EventManageView {
  id: string;
  titles: TranslationMap;
  descriptions: TranslationMap;
  photoThumbUrl: string | null;
  photoDetailUrl: string | null;
  startAtLocal: string;
  endAtLocal: string | null;
  locationText: string;
  infoEntryId: string | null;
  capacity: number | null;
  price: number;
  includedFor: StayType[];
  status: EventStatus;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventListItemView extends EventManageView {
  /** SUM(partySize) of `status='booked'` bookings — batch-loaded, never N+1. */
  bookedCount: number;
}

/** Flat DTO fields (`titleAr`…`titleDe`) ↔ the `titles` JSONB map. */
const TITLE_KEYS = [
  ['titleAr', 'ar'],
  ['titleEn', 'en'],
  ['titleRu', 'ru'],
  ['titleFr', 'fr'],
  ['titleIt', 'it'],
  ['titleEs', 'es'],
  ['titleDe', 'de'],
] as const;

const DESCRIPTION_KEYS = [
  ['descriptionAr', 'ar'],
  ['descriptionEn', 'en'],
  ['descriptionRu', 'ru'],
  ['descriptionFr', 'fr'],
  ['descriptionIt', 'it'],
  ['descriptionEs', 'es'],
  ['descriptionDe', 'de'],
] as const;

type TitleFields = Partial<Record<(typeof TITLE_KEYS)[number][0], string>>;
type DescriptionFields = Partial<
  Record<(typeof DESCRIPTION_KEYS)[number][0], string>
>;

function mergeTranslations(
  dto: Record<string, string | undefined>,
  keys: typeof TITLE_KEYS | typeof DESCRIPTION_KEYS,
  existing: TranslationMap,
  code: string,
): TranslationMap {
  const map: TranslationMap = { ...existing };
  for (const [dtoKey, lang] of keys) {
    const value = dto[dtoKey];
    if (value === undefined) continue;
    if (value.trim()) map[lang] = value.trim();
    else delete map[lang];
  }
  if (!map.ar || !map.en) {
    throw new BadRequestException({
      code,
      message: 'Arabic and English are required',
    });
  }
  return map;
}

const mergeTitles = (dto: TitleFields, existing: TranslationMap = {}): TranslationMap =>
  mergeTranslations(dto, TITLE_KEYS, existing, 'EVENT_TITLES_REQUIRED');

const mergeDescriptions = (
  dto: DescriptionFields,
  existing: TranslationMap = {},
): TranslationMap => mergeTranslations(dto, DESCRIPTION_KEYS, existing, 'EVENT_DESCRIPTIONS_REQUIRED');

const touchesTitles = (dto: TitleFields): boolean =>
  TITLE_KEYS.some(([key]) => dto[key] !== undefined);

const touchesDescriptions = (dto: DescriptionFields): boolean =>
  DESCRIPTION_KEYS.some(([key]) => dto[key] !== undefined);

/**
 * Story 21.2 — event CRUD. Every lookup filters by `hotelId` → cross-tenant
 * is a 404 (repo law). The safe-edit matrix (`assertEditable`) is the
 * load-bearing rule: once an event is published, guests may already be
 * booked against its schedule/price, so those fields lock; only cosmetic
 * fields and capacity increases stay open. `publish`/`cancel` transitions
 * and booking/attendee reads are later tasks (21.2 cont'd / 21.4).
 */
@Injectable()
export class TenantEventsService {
  private readonly logger = new Logger(TenantEventsService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventsRepo: Repository<Event>,
    @InjectRepository(EventBooking)
    private readonly bookingsRepo: Repository<EventBooking>,
    @InjectRepository(HotelInfoEntry)
    private readonly infoRepo: Repository<HotelInfoEntry>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
    private readonly auditLogs: AuditLogsService,
    private readonly dataSource: DataSource,
    private readonly announcements: TenantAnnouncementsService,
  ) {}

  async create(user: TenantUser, dto: CreateEventDto): Promise<EventManageView> {
    const titles = mergeTitles(dto);
    const descriptions = mergeDescriptions(dto);
    const infoEntryId = await this.resolveInfoEntry(
      user.hotelId,
      dto.infoEntryId ?? null,
    );
    this.assertValidWindow(dto.startAtLocal, dto.endAtLocal ?? null);

    const event = await this.eventsRepo.save(
      this.eventsRepo.create({
        hotelId: user.hotelId,
        titles,
        descriptions,
        photoKeys: null,
        startAtLocal: dto.startAtLocal,
        endAtLocal: dto.endAtLocal ?? null,
        locationText: dto.locationText,
        infoEntryId,
        capacity: dto.capacity ?? null,
        price: dto.price ?? 0,
        includedFor: dto.includedFor ?? [],
        status: 'draft',
        cancelReason: null,
        createdById: user.id,
        publishedAt: null,
        cancelledAt: null,
        completedAt: null,
        cancelledById: null,
      }),
    );

    await this.audit(user, 'event.created', event.id, {
      created: { from: null, to: { titleEn: titles.en, startAtLocal: event.startAtLocal } },
    });
    return this.toManageView(event);
  }

  async update(
    user: TenantUser,
    id: string,
    dto: UpdateEventDto,
  ): Promise<EventManageView> {
    const event = await this.findEvent(user.hotelId, id);
    this.assertEditable(event, dto);

    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (touchesTitles(dto)) {
      const next = mergeTitles(dto, event.titles);
      diff.titles = { from: event.titles, to: next };
      event.titles = next;
    }
    if (touchesDescriptions(dto)) {
      const next = mergeDescriptions(dto, event.descriptions);
      diff.descriptions = { from: event.descriptions, to: next };
      event.descriptions = next;
    }
    if (dto.startAtLocal !== undefined && dto.startAtLocal !== event.startAtLocal) {
      diff.startAtLocal = { from: event.startAtLocal, to: dto.startAtLocal };
      event.startAtLocal = dto.startAtLocal;
    }
    if (dto.endAtLocal !== undefined && dto.endAtLocal !== event.endAtLocal) {
      diff.endAtLocal = { from: event.endAtLocal, to: dto.endAtLocal };
      event.endAtLocal = dto.endAtLocal;
    }
    if (dto.locationText !== undefined && dto.locationText !== event.locationText) {
      diff.locationText = { from: event.locationText, to: dto.locationText };
      event.locationText = dto.locationText;
    }
    if (dto.infoEntryId !== undefined) {
      const next = await this.resolveInfoEntry(user.hotelId, dto.infoEntryId);
      if (next !== event.infoEntryId) {
        diff.infoEntryId = { from: event.infoEntryId, to: next };
        event.infoEntryId = next;
      }
    }
    if (dto.capacity !== undefined && dto.capacity !== event.capacity) {
      diff.capacity = { from: event.capacity, to: dto.capacity };
      event.capacity = dto.capacity;
    }
    if (dto.price !== undefined && dto.price !== event.price) {
      diff.price = { from: event.price, to: dto.price };
      event.price = dto.price;
    }
    if (
      dto.includedFor !== undefined &&
      JSON.stringify(dto.includedFor) !== JSON.stringify(event.includedFor)
    ) {
      diff.includedFor = { from: event.includedFor, to: dto.includedFor };
      event.includedFor = dto.includedFor;
    }

    if (diff.startAtLocal || diff.endAtLocal) {
      this.assertValidWindow(event.startAtLocal, event.endAtLocal);
    }

    if (Object.keys(diff).length > 0) {
      await this.eventsRepo.save(event);
      await this.audit(user, 'event.updated', event.id, diff);
    }
    return this.toManageView(event);
  }

  async list(
    user: TenantUser,
    query: ListTenantEventsQueryDto,
  ): Promise<{ data: EventListItemView[] }> {
    const qb = this.eventsRepo
      .createQueryBuilder('e')
      .where('e.hotelId = :hotelId', { hotelId: user.hotelId });

    if (query.tab === 'upcoming') {
      // final-review I1 — a published event that has already STARTED but
      // isn't auto-completed yet (the scheduler only flips status at
      // endAtLocal ?? start+180min) must still show up somewhere staff can
      // find it. `upcoming` is the right home: it's still "today's
      // programme," not history, so published events aren't time-filtered
      // here at all — only draft/published belong to `past`/`cancelled`.
      qb.andWhere(`(e.status = 'draft' OR e.status = 'published')`).orderBy(
        'e.startAtLocal',
        'ASC',
      );
    } else if (query.tab === 'past') {
      qb.andWhere(`e.status = 'completed'`).orderBy('e.startAtLocal', 'DESC');
    } else {
      qb.andWhere(`e.status = 'cancelled'`).orderBy('e.startAtLocal', 'DESC');
    }

    const events = await qb.getMany();
    return { data: await this.toListViews(events) };
  }

  async get(user: TenantUser, id: string): Promise<EventManageView> {
    const event = await this.findEvent(user.hotelId, id);
    return this.toManageView(event);
  }

  /**
   * Story 21.3 AC1 — draft → published, start time must still be in the
   * hotel-local future. `announce !== false` (the checkbox default is ON)
   * fires a normal Epic 19 announcement through
   * `TenantAnnouncementsService.create()` — title + a short auto-composed
   * body per language, audience `{}` (all current guests, per-event
   * targeting deferred per spec), badged `source: 'event_publish'`.
   */
  async publish(
    user: TenantUser,
    id: string,
    dto: PublishEventDto,
  ): Promise<EventManageView> {
    const event = await this.findEvent(user.hotelId, id);
    if (event.status !== 'draft') {
      throw new ConflictException({
        code: 'EVENT_NOT_PUBLISHABLE',
        message: 'Only draft events can be published',
      });
    }

    const hotel = await this.hotelsRepo.findOne({ where: { id: user.hotelId } });
    const nowLocal = hotelLocalStamp(hotel?.timezone ?? 'UTC', new Date());
    if (event.startAtLocal <= nowLocal) {
      throw new BadRequestException({
        code: 'EVENT_START_IN_PAST',
        message: 'The event start time must be in the future to publish',
      });
    }

    event.status = 'published';
    event.publishedAt = new Date();
    await this.eventsRepo.save(event);
    await this.audit(user, 'event.published', event.id, {
      status: { from: 'draft', to: 'published' },
    });

    if (dto.announce !== false) {
      // final-review C2 — a notification failure must never fail the
      // emitting business operation (repo law). The event is already
      // committed as published by this point; don't let the announcement
      // pipeline turn that success into an HTTP error.
      const content = composePublishAnnouncement(event);
      try {
        await this.announcements.create(
          user,
          {
            ...content,
            action: 'send',
            audience: {},
          } as CreateAnnouncementDto,
          { source: 'event_publish', eventId: event.id },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send event-publish announcement for event ${event.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return this.toManageView(event);
  }

  /**
   * Story 21.2 AC3 — published → cancelled, reason required. Locks the
   * `Event` row `pessimistic_write` (mutually exclusive with a concurrent
   * `book()`, Task 7 — the tenant-stays lock-first discipline) inside a
   * single transaction that also cascades every active `EventBooking` to
   * `cancelled/staff` and releases capacity. The targeted guest-facing
   * cancellation notice fires AFTER the transaction commits, and only when
   * at least one booking was actually cancelled (21.3 AC3 — the publish
   * announcement and this one are independent records; neither touches the
   * other).
   *
   * final-review C2 — bookings deliberately survive guest checkout (Story
   * 21.5 AC3: the booking stays `booked`, only the `Stay` becomes
   * `checked_out`), so `stayIds` collected here can include stays that are
   * no longer `active`. `resolveAudience()` on the announcements side
   * requires EVERY id to resolve to an active stay, so we filter to
   * currently-active stays before building the audience — a checked-out
   * guest can't receive an in-app notice anyway — and skip the announcement
   * entirely if nothing active is left. The `announcements.create()` call
   * is also wrapped so a notification failure never fails the cancel
   * itself, which has already committed by this point.
   */
  async cancel(
    user: TenantUser,
    id: string,
    dto: CancelEventDto,
  ): Promise<EventManageView> {
    const { event, bookingsCancelled, stayIds } = await this.dataSource.transaction(
      async (manager) => {
        const eventsRepo = manager.getRepository(Event);
        const bookingsRepo = manager.getRepository(EventBooking);

        const event = await eventsRepo.findOne({
          where: { id, hotelId: user.hotelId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!event) {
          throw new NotFoundException({
            code: 'EVENT_NOT_FOUND',
            message: 'Event not found',
          });
        }
        if (event.status !== 'published') {
          throw new ConflictException({
            code: 'EVENT_NOT_CANCELLABLE',
            message: 'Only published events can be cancelled',
          });
        }

        const now = new Date();
        event.status = 'cancelled';
        event.cancelReason = dto.reason;
        event.cancelledAt = now;
        event.cancelledById = user.id;
        await eventsRepo.save(event);

        const bookings = await bookingsRepo.find({
          where: { eventId: event.id, status: 'booked' },
        });
        for (const booking of bookings) {
          booking.status = 'cancelled';
          booking.cancelledBy = 'staff';
          booking.cancelledAt = now;
          booking.cancelledReason = dto.reason;
        }
        if (bookings.length) await bookingsRepo.save(bookings);

        const stayIds = [...new Set(bookings.map((b) => b.stayId))];
        return { event, bookingsCancelled: bookings.length, stayIds };
      },
    );

    await this.audit(user, 'event.cancelled', event.id, { bookingsCancelled });

    if (bookingsCancelled > 0) {
      // A checked-out guest's stay is no longer `active`; `resolveAudience`
      // 400s if ANY id in the list fails to resolve, so filter first —
      // still-resident guests must get the notice even when some booked
      // guests already checked out.
      const activeStayIds = stayIds.length
        ? (
            await this.staysRepo.find({
              where: { id: In(stayIds), hotelId: user.hotelId, status: 'active' },
            })
          ).map((s) => s.id)
        : [];

      if (activeStayIds.length > 0) {
        const content = composeCancelAnnouncement(event, dto.reason);
        try {
          await this.announcements.create(
            user,
            {
              ...content,
              action: 'send',
              audience: { stayIds: activeStayIds },
            } as CreateAnnouncementDto,
            { source: 'event_cancel', eventId: event.id },
          );
        } catch (err) {
          this.logger.error(
            `Failed to send event-cancel announcement for event ${event.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    return this.toManageView(event);
  }

  // ------------------------------------------------------------------
  // Shared internals
  // ------------------------------------------------------------------

  /** Exposed for `EventPhotoService` (the F&B `findItem` precedent). */
  async findEvent(hotelId: string, id: string): Promise<Event> {
    const event = await this.eventsRepo.findOne({ where: { id, hotelId } });
    if (!event) {
      throw new NotFoundException({
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found',
      });
    }
    return event;
  }

  /**
   * Exposed for `EventPhotoService` (final-review I2) — photo changes ride
   * the same safe-edit matrix as `update()`: allowed on `draft`/`published`,
   * locked on the terminal `completed`/`cancelled` statuses.
   */
  assertPhotoEditable(event: Event): void {
    if (event.status === 'completed' || event.status === 'cancelled') {
      this.throwNotSafeEdit();
    }
  }

  /** Exposed for `EventPhotoService` (the F&B `toItemView` precedent). */
  toManageView(event: Event): EventManageView {
    return {
      id: event.id,
      titles: event.titles,
      descriptions: event.descriptions,
      photoThumbUrl: event.photoKeys ? `files/${event.photoKeys.thumb}` : null,
      photoDetailUrl: event.photoKeys ? `files/${event.photoKeys.detail}` : null,
      startAtLocal: event.startAtLocal,
      endAtLocal: event.endAtLocal,
      locationText: event.locationText,
      infoEntryId: event.infoEntryId,
      capacity: event.capacity,
      price: event.price,
      includedFor: event.includedFor,
      status: event.status,
      cancelReason: event.cancelReason,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  private async toListViews(events: Event[]): Promise<EventListItemView[]> {
    if (events.length === 0) return [];
    const counts = await this.bookedCounts(events.map((e) => e.id));
    return events.map((event) => ({
      ...this.toManageView(event),
      bookedCount: counts.get(event.id) ?? 0,
    }));
  }

  /** One grouped query for the whole page — never N+1 (the F&B `toViews` rule). */
  private async bookedCounts(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.bookingsRepo
      .createQueryBuilder('b')
      .select('b.eventId', 'eventId')
      .addSelect('COALESCE(SUM(b.partySize), 0)', 'total')
      .where('b.eventId IN (:...eventIds)', { eventIds })
      .andWhere(`b.status = 'booked'`)
      .groupBy('b.eventId')
      .getRawMany<{ eventId: string; total: string }>();
    return new Map(rows.map((row) => [row.eventId, parseInt(row.total, 10)]));
  }

  private async resolveInfoEntry(
    hotelId: string,
    infoEntryId: string | null | undefined,
  ): Promise<string | null> {
    if (!infoEntryId) return null;
    const entry = await this.infoRepo.findOne({
      where: { id: infoEntryId, hotelId },
    });
    if (!entry) {
      throw new BadRequestException({
        code: 'EVENT_INFO_ENTRY_NOT_FOUND',
        message: 'The linked Hotel Info entry was not found',
      });
    }
    return infoEntryId;
  }

  private assertValidWindow(startAtLocal: string, endAtLocal: string | null): void {
    if (endAtLocal && endAtLocal <= startAtLocal) {
      throw new BadRequestException({
        code: 'EVENT_WINDOW_INVALID',
        message: 'End time must be after the start time',
      });
    }
  }

  /**
   * The safe-edit matrix (Story 21.2 AC1/AC2): draft is fully editable;
   * published allows only description, photo, and capacity increases — AC1
   * groups the optional Hotel Info entry link under the `location` field
   * conceptually, so `infoEntryId` locks alongside `locationText`, not
   * alongside `titles`/`descriptions`. completed/cancelled lock everything.
   */
  private assertEditable(event: Event, dto: UpdateEventDto): void {
    if (event.status === 'draft') return;

    if (event.status === 'published') {
      const capacitySafe =
        dto.capacity === undefined ||
        dto.capacity === null ||
        event.capacity === null ||
        dto.capacity >= event.capacity;
      const touchesRestricted =
        dto.startAtLocal !== undefined ||
        dto.endAtLocal !== undefined ||
        dto.price !== undefined ||
        dto.includedFor !== undefined ||
        dto.locationText !== undefined ||
        dto.infoEntryId !== undefined ||
        !capacitySafe;
      if (touchesRestricted) this.throwNotSafeEdit();
      return;
    }

    // completed | cancelled — terminal, nothing editable.
    if (this.hasAnyField(dto)) this.throwNotSafeEdit();
  }

  private hasAnyField(dto: UpdateEventDto): boolean {
    return (
      touchesTitles(dto) ||
      touchesDescriptions(dto) ||
      dto.startAtLocal !== undefined ||
      dto.endAtLocal !== undefined ||
      dto.locationText !== undefined ||
      dto.infoEntryId !== undefined ||
      dto.capacity !== undefined ||
      dto.price !== undefined ||
      dto.includedFor !== undefined
    );
  }

  private throwNotSafeEdit(): never {
    throw new ConflictException({
      code: 'EVENT_NOT_SAFE_EDIT',
      message:
        "This event is live or finished, so its schedule, price and capacity can't be reduced or changed. Cancel it and create a new event instead.",
    });
  }

  private async audit(
    user: TenantUser,
    action: string,
    entityId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action,
      entityType: 'event',
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
