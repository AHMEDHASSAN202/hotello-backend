import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    private readonly hotelsService: HotelsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly tenantUsersService: TenantUsersService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async onboard(dto: OnboardHotelDto, actor: Admin) {
    // Fast-fail validation before opening the transaction.
    await this.hotelsService.assertSlugUsable(dto.profile.slug);
    const ownerEmail = dto.owner.email.toLowerCase();
    await this.assertOwnerEmailAvailable(ownerEmail);

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

      const tenantUsersRepo = manager.getRepository(TenantUser);
      const owner = await tenantUsersRepo.save(
        tenantUsersRepo.create({
          hotelId: hotel.id,
          name: dto.owner.name,
          email: ownerEmail,
          role: 'owner',
          permissions: ['*'],
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

  /** Story 5.6 AC2 — 422 so the wizard keeps its state and targets step 3. */
  private async assertOwnerEmailAvailable(email: string) {
    const existing = await this.tenantUsersRepo.findOne({ where: { email } });
    if (existing) {
      throw new UnprocessableEntityException({
        message: 'Owner email already in use',
        field: 'owner.email',
      });
    }
  }
}
