import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  NOTIFICATION_EVENTS,
  OwnerSetupLinkRequestedEvent,
  safeEmit,
} from '../notifications/notification-events';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantRolesService } from '../tenant-roles/tenant-roles.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { OnboardHotelDto } from './dto/onboard-hotel.dto';
import { Hotel } from './hotel.entity';
import { HotelsService } from './hotels.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Story 5.3 — the onboarding wizard's backend. Kept separate from hotel CRUD
 * (implementation note 2): hotel + initial subscription + owner account +
 * setup token are created in ONE transaction; any failure persists nothing.
 */
@Injectable()
export class HotelOnboardingService {
  private readonly logger = new Logger(HotelOnboardingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly hotelsService: HotelsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly tenantUsersService: TenantUsersService,
    private readonly tenantRolesService: TenantRolesService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  async onboard(dto: OnboardHotelDto, actor: Admin) {
    // Fast-fail validation before opening the transaction.
    await this.hotelsService.assertSlugUsable(dto.profile.slug);
    // Owner email is unique PER HOTEL (Epic 08, Story 8.3 AC1: the same email
    // at another hotel is a different account), so an email that already owns
    // another hotel is fine here — the new hotel has no users yet, and the DB
    // composite unique (hotelId, email) backs the invariant.
    const ownerEmail = dto.owner.email.toLowerCase();

    const result = await this.dataSource.transaction(async (manager) => {
      const hotelsRepo = manager.getRepository(Hotel);
      const hotel = await hotelsRepo.save(
        hotelsRepo.create({
          nameEn: dto.profile.nameEn,
          nameAr: dto.profile.nameAr,
          slug: dto.profile.slug,
          status: 'active',
          contactEmail: dto.profile.contactEmail.toLowerCase(),
          contactPhone: dto.profile.contactPhone,
          city: dto.profile.city,
          ...(dto.profile.country ? { country: dto.profile.country } : {}),
          ...(dto.profile.timezone ? { timezone: dto.profile.timezone } : {}),
          ...(dto.profile.defaultLanguage
            ? { defaultLanguage: dto.profile.defaultLanguage }
            : {}),
          ...(dto.profile.currency ? { currency: dto.profile.currency } : {}),
          starRating: dto.profile.starRating ?? null,
          address: dto.profile.address ?? null,
          roomsCount: dto.profile.roomsCount ?? 0,
          onboardedById: actor.id,
        }),
      );

      const subscription =
        await this.subscriptionsService.createInitialSubscription(
          manager,
          hotel,
          dto.plan,
          actor,
        );

      // Story 9.1 AC1 — seed the hotel's default roles inside the same
      // transaction; the owner is assigned the seeded (system) Owner role.
      const roles = await this.tenantRolesService.seedDefaultRoles(
        hotel.id,
        manager,
      );
      const ownerRole = roles.find((r) => r.isSystem)!;

      const tenantUsersRepo = manager.getRepository(TenantUser);
      const owner = await tenantUsersRepo.save(
        tenantUsersRepo.create({
          hotelId: hotel.id,
          name: dto.owner.name,
          email: ownerEmail,
          roleId: ownerRole.id,
          status: 'pending',
        }),
      );
      const token = await this.tenantUsersService.issueSetupToken(
        owner,
        manager,
      );

      return { hotel, subscription, owner, token };
    });

    // Post-commit — an audit row must not exist for a rolled-back hotel.
    await this.auditLogs.log({
      action: 'hotel.created',
      entityType: 'hotel',
      entityId: result.hotel.id,
      actorId: actor.id,
      metadata: {
        slug: result.hotel.slug,
        planId: result.subscription.planId,
        billingCycle: result.subscription.billingCycle,
        ownerEmail,
      },
    });

    // Story 6.4 AC1 — automated setup email. The raw token exists only in
    // this call stack; the awaited listener persists a masked outbox record
    // before we return (persist-first), then sends in the background.
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.OWNER_SETUP_LINK_REQUESTED,
      {
        hotelId: result.hotel.id,
        ownerId: result.owner.id,
        ownerName: result.owner.name,
        ownerEmail: result.owner.email,
        hotelNameEn: result.hotel.nameEn,
        hotelNameAr: result.hotel.nameAr,
        slug: result.hotel.slug,
        language: result.hotel.defaultLanguage,
        rawToken: result.token.raw,
        expiresAt: result.token.expiresAt,
      } satisfies OwnerSetupLinkRequestedEvent,
      this.logger,
    );

    return {
      hotel: this.hotelsService.toDetail(result.hotel, result.owner),
      subscription: {
        id: result.subscription.id,
        status: result.subscription.status,
        billingCycle: result.subscription.billingCycle,
        trialEndsAt: result.subscription.trialEndsAt,
        daysRemaining: result.subscription.trialEndsAt
          ? Math.max(
              0,
              Math.ceil(
                (result.subscription.trialEndsAt.getTime() - Date.now()) /
                  DAY_MS,
              ),
            )
          : null,
      },
      owner: {
        id: result.owner.id,
        name: result.owner.name,
        email: result.owner.email,
        status: result.owner.status,
        // The raw link is returned exactly once (Story 5.6 AC3).
        setupLink: this.tenantUsersService.buildSetupLink(
          result.hotel.slug,
          result.token.raw,
        ),
        setupLinkExpiresAt: result.token.expiresAt,
      },
    };
  }

}
