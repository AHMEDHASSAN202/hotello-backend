import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  HotelReactivatedEvent,
  HotelSuspendedEvent,
  NOTIFICATION_EVENTS,
  safeEmit,
} from '../notifications/notification-events';
import { WILDCARD } from '../roles/permissions.constants';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { Subscription } from '../subscriptions/subscription.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ListHotelsQueryDto } from './dto/list-hotels-query.dto';
import { SuspendHotelDto } from './dto/suspend-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel } from './hotel.entity';
import {
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  RESERVED_SLUGS,
  SLUG_REGEX,
} from './hotels.constants';
import { TenantUrlsService } from './tenant-urls.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Profile fields the diff audit tracks (Story 5.4 AC4). */
const PROFILE_FIELDS = [
  'nameEn',
  'nameAr',
  'contactEmail',
  'contactPhone',
  'address',
  'city',
  'country',
  'timezone',
  'defaultLanguage',
  'currency',
  'starRating',
  'roomsCount',
] as const;

type HotelWithCurrentSub = Hotel & { currentSubscription?: Subscription };

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    @InjectRepository(Subscription)
    private readonly subsRepo: Repository<Subscription>,
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly tenantUrls: TenantUrlsService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Story 5.1 — paginated list with current plan + subscription status. */
  async findAll(query: ListHotelsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.hotelsRepo
      .createQueryBuilder('hotel')
      .leftJoinAndMapOne(
        'hotel.currentSubscription',
        Subscription,
        'sub',
        'sub.hotelId = hotel.id AND sub.endDate IS NULL',
      )
      .leftJoinAndSelect('sub.plan', 'plan');

    if (query.search) {
      qb.andWhere(
        '(hotel.nameEn ILIKE :search OR hotel.nameAr ILIKE :search OR hotel.slug ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.status) qb.andWhere('hotel.status = :status', { status: query.status });
    if (query.subscriptionStatus) {
      qb.andWhere('sub.status = :subStatus', {
        subStatus: query.subscriptionStatus,
      });
    }
    if (query.planId) qb.andWhere('sub.planId = :planId', { planId: query.planId });
    if (query.city) {
      qb.andWhere('hotel.city ILIKE :city', { city: `%${query.city}%` });
    }

    const dir = query.sortDir === 'asc' ? 'ASC' : 'DESC';
    if (query.sortBy === 'name') qb.orderBy('hotel.nameEn', dir);
    else if (query.sortBy === 'plan') qb.orderBy('plan.nameEn', dir, 'NULLS LAST');
    else qb.orderBy('hotel.createdAt', dir);

    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: rows.map((hotel) => this.toListItem(hotel)),
      total,
      page,
      pageSize,
    };
  }

  /** Stories 5.2 / 5.7 — full profile + owner + computed tenant URLs. */
  async findOne(id: string) {
    const hotel = await this.hotelsRepo.findOne({
      where: { id },
      relations: ['onboardedBy', 'suspendedBy'],
    });
    if (!hotel)
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    const owner = await this.tenantUsersRepo.findOne({
      where: { hotelId: id, role: { isSystem: true } },
      relations: ['role'],
    });
    return this.toDetail(hotel, owner);
  }

  /** Story 5.3 AC3 — live slug validation for the wizard; never throws. */
  async checkSlug(slug: string) {
    if (!SLUG_REGEX.test(slug)) {
      return { available: false, reason: 'invalid' as const };
    }
    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
      return { available: false, reason: 'reserved' as const };
    }
    const existing = await this.hotelsRepo.findOne({ where: { slug } });
    if (existing) return { available: false, reason: 'taken' as const };
    return { available: true };
  }

  /** Validates a slug for create/update — throws with a specific error. */
  async assertSlugUsable(slug: string, excludeHotelId?: string) {
    if (!SLUG_REGEX.test(slug)) {
      throw new BadRequestException({
        code: 'SLUG_INVALID',
        message:
          'Slug must be lowercase kebab-case (a-z, 0-9, hyphens), 3–40 characters',
      });
    }
    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
      throw new BadRequestException({
        code: 'SLUG_RESERVED',
        message: `"${slug}" is a reserved word`,
      });
    }
    const existing = await this.hotelsRepo.findOne({ where: { slug } });
    if (existing && existing.id !== excludeHotelId) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: 'Slug is already taken',
      });
    }
  }

  /** Story 5.4 — profile edit with slug + rooms-count guards. */
  async update(id: string, dto: UpdateHotelDto, actor: Admin) {
    const hotel = await this.hotelsRepo.findOne({ where: { id } });
    if (!hotel)
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });

    // Slug immutability (5.3 AC3): wildcard only, separately audit-logged.
    let slugChange: { old: string; new: string } | null = null;
    if (dto.slug !== undefined && dto.slug !== hotel.slug) {
      if (!this.isWildcard(actor)) {
        throw new ForbiddenException({
          code: 'HOTEL_SLUG_FORBIDDEN',
          message: 'Only Super Admin (*) can change a hotel slug',
        });
      }
      await this.assertSlugUsable(dto.slug, id);
      slugChange = { old: hotel.slug, new: dto.slug };
      hotel.slug = dto.slug;
    }

    // Rooms-count vs plan limit (5.4 AC3) — mirrors the downgrade guard.
    const force = dto.force === true;
    if (force && !this.isWildcard(actor)) {
      throw new ForbiddenException({
        code: 'FORCE_LIMIT_FORBIDDEN',
        message: 'Only Super Admin (*) can force past plan limits',
      });
    }
    if (dto.roomsCount !== undefined && !force) {
      await this.assertRoomsWithinPlanLimit(hotel, dto.roomsCount);
    }

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of PROFILE_FIELDS) {
      const next = dto[field];
      if (next !== undefined && next !== hotel[field]) {
        diff[field] = { from: hotel[field], to: next };
        (hotel as unknown as Record<string, unknown>)[field] = next;
      }
    }

    const saved = await this.hotelsRepo.save(hotel);

    if (slugChange) {
      await this.auditLogs.log({
        action: 'hotel.slug_changed',
        entityType: 'hotel',
        entityId: id,
        actorId: actor.id,
        metadata: slugChange,
      });
    }
    if (Object.keys(diff).length > 0) {
      await this.auditLogs.log({
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: id,
        actorId: actor.id,
        metadata: { diff, ...(force ? { force: true } : {}) },
      });
    }
    return this.findOne(saved.id);
  }

  /** Story 5.5 — full tenant lock; the subscription is left untouched. */
  async suspend(id: string, dto: SuspendHotelDto, actor: Admin) {
    const hotel = await this.hotelsRepo.findOne({ where: { id } });
    if (!hotel)
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    if (hotel.status === 'suspended') {
      throw new ConflictException({
        code: 'HOTEL_ALREADY_SUSPENDED',
        message: 'Hotel is already suspended',
      });
    }

    hotel.status = 'suspended';
    hotel.suspensionReason = dto.reason;
    hotel.suspensionNote = dto.note ?? null;
    hotel.suspendedAt = new Date();
    hotel.suspendedById = actor.id;
    await this.hotelsRepo.save(hotel);

    await this.auditLogs.log({
      action: 'hotel.suspended',
      entityType: 'hotel',
      entityId: id,
      actorId: actor.id,
      metadata: { reason: dto.reason, note: dto.note ?? null },
    });

    // Story 6.6 AC1 — owner notice carries the category only, never the note.
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.HOTEL_SUSPENDED,
      {
        hotelId: id,
        reason: dto.reason,
        suspendedAt: hotel.suspendedAt!,
      } satisfies HotelSuspendedEvent,
      this.logger,
    );
    return this.findOne(id);
  }

  /** Story 5.5 AC5 — restores prior access immediately. */
  async reactivate(id: string, actor: Admin) {
    const hotel = await this.hotelsRepo.findOne({ where: { id } });
    if (!hotel)
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    if (hotel.status !== 'suspended') {
      throw new ConflictException({
        code: 'HOTEL_NOT_SUSPENDED',
        message: 'Hotel is not suspended',
      });
    }

    hotel.status = 'active';
    hotel.suspensionReason = null;
    hotel.suspensionNote = null;
    hotel.suspendedAt = null;
    hotel.suspendedById = null;
    await this.hotelsRepo.save(hotel);

    await this.auditLogs.log({
      action: 'hotel.reactivated',
      entityType: 'hotel',
      entityId: id,
      actorId: actor.id,
    });

    // Story 6.6 AC2 — the timestamp is the per-occurrence idempotency
    // discriminator (no column stores it after the flags are cleared).
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.HOTEL_REACTIVATED,
      { hotelId: id, occurredAt: new Date() } satisfies HotelReactivatedEvent,
      this.logger,
    );
    return this.findOne(id);
  }

  /** Story 5.3 AC2 / note 10 — png/jpg/webp/svg, ≤ 2MB; stores the key. */
  async uploadLogo(id: string, file: Express.Multer.File, actor: Admin) {
    const hotel = await this.hotelsRepo.findOne({ where: { id } });
    if (!hotel)
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    if (!file)
      throw new BadRequestException({
        code: 'NO_FILE',
        message: 'No file uploaded',
      });

    const ext = LOGO_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException({
        code: 'LOGO_INVALID_TYPE',
        message: 'Logo must be PNG, JPG, WebP or SVG',
      });
    }
    if (file.size > LOGO_MAX_BYTES) {
      throw new BadRequestException({
        code: 'LOGO_TOO_LARGE',
        message: 'Logo must be 2MB or smaller',
      });
    }

    const key = `hotels/${id}/logo-${Date.now()}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const previous = hotel.logoPath;
    hotel.logoPath = key;
    await this.hotelsRepo.save(hotel);
    if (previous) {
      // Best-effort cleanup — a dangling old object is not worth a 500.
      await this.storage.delete(previous).catch(() => undefined);
    }

    await this.auditLogs.log({
      action: 'hotel.updated',
      entityType: 'hotel',
      entityId: id,
      actorId: actor.id,
      metadata: { diff: { logoPath: { from: previous, to: key } } },
    });
    return { logoPath: key, logoUrl: this.logoUrl(key) };
  }

  private async assertRoomsWithinPlanLimit(hotel: Hotel, roomsCount: number) {
    const current = await this.subsRepo.findOne({
      where: { hotelId: hotel.id, endDate: IsNull() },
      relations: ['plan'],
    });
    const maxRooms = current?.plan?.maxRooms ?? null;
    if (maxRooms !== null && roomsCount > maxRooms) {
      throw new ConflictException({
        code: 'PLAN_LIMIT_VIOLATION',
        message: `Rooms count exceeds the current plan limit of ${maxRooms}`,
        violations: [
          {
            hotelId: hotel.id,
            hotelName: hotel.nameEn,
            field: 'maxRooms',
            usage: roomsCount,
            limit: maxRooms,
            message: `Requested ${roomsCount} rooms; current plan allows ${maxRooms}`,
          },
        ],
      });
    }
  }

  private isWildcard(actor: Admin): boolean {
    return actor.role?.permissions?.includes(WILDCARD) ?? false;
  }

  private toListItem(hotel: HotelWithCurrentSub) {
    const sub = hotel.currentSubscription;
    return {
      id: hotel.id,
      nameEn: hotel.nameEn,
      nameAr: hotel.nameAr,
      slug: hotel.slug,
      city: hotel.city,
      status: hotel.status,
      roomsCount: hotel.roomsCount,
      createdAt: hotel.createdAt,
      plan: sub?.plan
        ? {
            id: sub.plan.id,
            nameEn: sub.plan.nameEn,
            nameAr: sub.plan.nameAr,
            isTrial: sub.plan.isTrial,
          }
        : null,
      subscription: sub
        ? {
            status: sub.status,
            trialEndsAt: sub.trialEndsAt,
            daysRemaining:
              sub.status === 'trial' && sub.trialEndsAt
                ? this.daysUntil(sub.trialEndsAt)
                : null,
          }
        : null,
    };
  }

  toDetail(hotel: Hotel, owner: TenantUser | null) {
    return {
      id: hotel.id,
      nameEn: hotel.nameEn,
      nameAr: hotel.nameAr,
      slug: hotel.slug,
      status: hotel.status,
      logoPath: hotel.logoPath,
      logoUrl: hotel.logoPath ? this.logoUrl(hotel.logoPath) : null,
      starRating: hotel.starRating,
      contactEmail: hotel.contactEmail,
      contactPhone: hotel.contactPhone,
      address: hotel.address,
      city: hotel.city,
      country: hotel.country,
      timezone: hotel.timezone,
      defaultLanguage: hotel.defaultLanguage,
      currency: hotel.currency,
      roomsCount: hotel.roomsCount,
      staffUsersCount: hotel.staffUsersCount,
      monthlyGuestRequests: hotel.monthlyGuestRequests,
      suspension:
        hotel.status === 'suspended'
          ? {
              reason: hotel.suspensionReason,
              note: hotel.suspensionNote,
              suspendedAt: hotel.suspendedAt,
              suspendedBy: hotel.suspendedBy
                ? { id: hotel.suspendedBy.id, name: hotel.suspendedBy.name }
                : null,
            }
          : null,
      onboardedBy: hotel.onboardedBy
        ? {
            id: hotel.onboardedBy.id,
            name: hotel.onboardedBy.name,
            email: hotel.onboardedBy.email,
          }
        : null,
      owner: owner
        ? {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            status: owner.status,
            lastLoginAt: owner.lastLoginAt,
          }
        : null,
      urls: this.tenantUrls.buildUrls(hotel.slug),
      createdAt: hotel.createdAt,
      updatedAt: hotel.updatedAt,
    };
  }

  private logoUrl(key: string): string {
    return `/files/${key}`;
  }

  private daysUntil(date: Date): number {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
  }
}
