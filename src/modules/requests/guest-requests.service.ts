import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { naiveUtc, startOfHotelDay } from '../tenant-stays/stay-time';
import { GuestLanguage } from '../tenant-stays/stays.constants';
import { Stay } from '../tenant-stays/stay.entity';
import { CreateGuestRequestDto } from './dto/create-guest-request.dto';
import { ListGuestRequestsQueryDto } from './dto/list-guest-requests-query.dto';
import { GuestRequest } from './request.entity';
import { RequestCatalogViewService } from './request-catalog-view.service';
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_TIME_OPTION_REGEX,
  localizeField,
} from './requests.constants';

/** What the Guest App renders — localized server-side to the stay language. */
export interface GuestCatalogItemView {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  optionType: string | null;
  optionMin: number | null;
  optionMax: number | null;
}

export interface GuestCatalogCategoryView {
  id: string;
  name: string;
  icon: string;
  items: GuestCatalogItemView[];
}

export interface GuestRequestView {
  id: string;
  itemName: string;
  icon: string;
  optionType: string | null;
  optionValue: string | null;
  note: string | null;
  status: string;
  slaTargetMinutes: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  updatedAt: Date;
}

/**
 * Epic 15, Stories 15.2/15.3 — the guest side of the requests loop.
 *
 * `hotel_id`/`stay_id`/room binding all derive from the JWT-loaded Stay
 * (contract: identity = session, 15.2 AC4) — no client-sent ids are trusted.
 * Module/subscription gating happens HERE, not in TenantAccessGuard (the
 * guard no-ops on @GuestScope routes — recorded decision).
 */
@Injectable()
export class GuestRequestsService {
  private readonly maxOpenPerStay: number;
  private readonly maxPerDay: number;

  constructor(
    @InjectRepository(GuestRequest)
    private readonly requestsRepo: Repository<GuestRequest>,
    private readonly catalogView: RequestCatalogViewService,
    private readonly access: TenantAccessService,
    private readonly auditLogs: AuditLogsService,
    config: ConfigService,
  ) {
    this.maxOpenPerStay = parseInt(
      config.get('GUEST_REQUESTS_MAX_OPEN_PER_STAY', '5'),
      10,
    );
    this.maxPerDay = parseInt(
      config.get('GUEST_REQUESTS_MAX_PER_DAY', '15'),
      10,
    );
  }

  /**
   * Suspended hotel / expired (read-only) subscription → the whole guest
   * requests surface is unavailable (matches the profile's `unavailable`);
   * plan without the module → MODULE_NOT_ENABLED (tile falls back to "soon").
   */
  private async assertRequestsAvailable(hotelId: string): Promise<void> {
    const state = await this.access.getAccessState(hotelId);
    if (state.hotelStatus === 'suspended' || state.readOnly) {
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }
    if (!state.enabledModules.includes('requests')) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: 'This module is not included in your plan',
        module: 'requests',
      });
    }
  }

  /** 15.2 AC2 — enabled items only, localized, empty categories dropped. */
  async getCatalog(
    stay: Stay,
  ): Promise<{ categories: GuestCatalogCategoryView[] }> {
    await this.assertRequestsAvailable(stay.hotelId);
    const catalog = await this.catalogView.getEffectiveCatalog(stay.hotelId);
    const categories = catalog
      .filter((c) => c.enabled)
      .map((c) => ({
        id: c.category.id,
        name: localizeField(c.category.names, stay.language),
        icon: c.category.icon,
        items: c.items
          .filter((e) => e.enabled)
          .map((e) => ({
            id: e.item.id,
            name: localizeField(e.item.names, stay.language),
            description: e.item.descriptions
              ? localizeField(e.item.descriptions, stay.language) || null
              : null,
            icon: e.item.icon,
            optionType: e.item.optionType,
            optionMin: e.item.optionMin,
            optionMax: e.item.optionMax,
          })),
      }))
      .filter((c) => c.items.length > 0);
    return { categories };
  }

  /** 15.2 AC3–AC5 — submit with server-side throttles and option validation. */
  async submit(
    stay: Stay,
    dto: CreateGuestRequestDto,
  ): Promise<GuestRequestView> {
    await this.assertRequestsAvailable(stay.hotelId);
    const now = new Date();

    const openCount = await this.requestsRepo.count({
      where: { stayId: stay.id, status: In(OPEN_REQUEST_STATUSES) },
    });
    if (openCount >= this.maxOpenPerStay) {
      throw new HttpException(
        {
          code: 'REQUEST_LIMIT_OPEN',
          message: 'Too many open requests for this stay',
          limit: this.maxOpenPerStay,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const dayCount = await this.requestsRepo.count({
      where: {
        stayId: stay.id,
        createdAt: MoreThanOrEqual(
          naiveUtc(startOfHotelDay(stay.hotel.timezone, now)),
        ),
      },
    });
    if (dayCount >= this.maxPerDay) {
      throw new HttpException(
        {
          code: 'REQUEST_LIMIT_DAILY',
          message: 'Daily request limit reached for this stay',
          limit: this.maxPerDay,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resolved = await this.catalogView.findItemForHotel(
      stay.hotelId,
      dto.itemId,
    );
    if (!resolved) {
      throw new NotFoundException({
        code: 'REQUEST_ITEM_NOT_FOUND',
        message: 'Request item not found',
      });
    }
    if (!resolved.enabled || !resolved.categoryEnabled) {
      throw new ConflictException({
        code: 'REQUEST_ITEM_DISABLED',
        message: 'This request is not available right now',
      });
    }
    const optionValue = this.validateOption(resolved.item, dto.optionValue);
    const note = dto.note?.trim() || null;

    const saved = await this.requestsRepo.save(
      this.requestsRepo.create({
        hotelId: stay.hotelId,
        stayId: stay.id,
        roomId: stay.roomId,
        roomNumber: stay.room.roomNumber,
        itemId: resolved.item.id,
        categoryId: resolved.item.categoryId,
        itemNames: resolved.item.names as Record<string, string>,
        itemIcon: resolved.item.icon,
        optionType: resolved.item.optionType,
        optionValue,
        note,
        noteLanguage: note ? stay.language : null,
        status: 'new',
        slaTargetMinutes: resolved.slaMinutes,
        dueAt: new Date(now.getTime() + resolved.slaMinutes * 60_000),
        assignedToId: null,
      }),
    );
    await this.auditLogs.log({
      action: 'request.created',
      entityType: 'request',
      entityId: saved.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        itemId: resolved.item.id,
      },
    });
    return this.toView(saved, stay.language);
  }

  /** 15.3 AC1/AC2 — own stay only; `updatedSince` returns deltas (note 4). */
  async listForStay(
    stay: Stay,
    query: ListGuestRequestsQueryDto,
  ): Promise<{ data: GuestRequestView[]; serverTime: string }> {
    await this.assertRequestsAvailable(stay.hotelId);
    const where = query.updatedSince
      ? { stayId: stay.id, updatedAt: MoreThan(naiveUtc(query.updatedSince)) }
      : { stayId: stay.id };
    const rows = await this.requestsRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return {
      data: rows.map((r) => this.toView(r, stay.language)),
      serverTime: new Date().toISOString(),
    };
  }

  /** 15.3 AC3 — cancellable while `new` only; lands as reason 'guest'. */
  async cancelOwn(stay: Stay, id: string): Promise<GuestRequestView> {
    const request = await this.requestsRepo.findOne({
      where: { id, stayId: stay.id },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'Request not found',
      });
    }
    if (request.status !== 'new') {
      throw new ConflictException({
        code: 'REQUEST_INVALID_STATUS',
        message: 'This request can no longer be cancelled',
        status: request.status,
      });
    }
    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.cancelledById = null;
    request.cancelledReason = 'guest';
    const saved = await this.requestsRepo.save(request);
    await this.auditLogs.log({
      action: 'request.cancelled',
      entityType: 'request',
      entityId: saved.id,
      actorId: null,
      metadata: {
        actorType: 'guest',
        hotelId: stay.hotelId,
        stayId: stay.id,
        reason: 'guest',
      },
    });
    return this.toView(saved, stay.language);
  }

  /** 400 REQUEST_OPTION_INVALID for every mismatch (15.1 AC3 bounds). */
  private validateOption(
    item: { optionType: string | null; optionMin: number | null; optionMax: number | null },
    raw: string | undefined,
  ): string | null {
    const fail = (): never => {
      throw new BadRequestException({
        code: 'REQUEST_OPTION_INVALID',
        message: 'Invalid option value for this item',
      });
    };
    if (!item.optionType) {
      if (raw !== undefined && raw !== null && raw !== '') fail();
      return null;
    }
    if (raw === undefined || raw === null || raw === '') fail();
    if (item.optionType === 'quantity') {
      if (!/^\d{1,4}$/.test(raw as string)) fail();
      const quantity = parseInt(raw as string, 10);
      if (
        (item.optionMin !== null && quantity < item.optionMin) ||
        (item.optionMax !== null && quantity > item.optionMax)
      ) {
        fail();
      }
      return String(quantity);
    }
    // time
    if (!REQUEST_TIME_OPTION_REGEX.test(raw as string)) fail();
    return raw as string;
  }

  private toView(
    request: GuestRequest,
    language: GuestLanguage,
  ): GuestRequestView {
    return {
      id: request.id,
      itemName: localizeField(request.itemNames, language),
      icon: request.itemIcon,
      optionType: request.optionType,
      optionValue: request.optionValue,
      note: request.note,
      status: request.status,
      slaTargetMinutes: request.slaTargetMinutes,
      createdAt: request.createdAt,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
      cancelledAt: request.cancelledAt,
      cancelledReason: request.cancelledReason,
      updatedAt: request.updatedAt,
    };
  }
}
