import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThan, Not, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Plan } from '../plans/plan.entity';
import { WILDCARD } from '../roles/permissions.constants';
import { ChangeSubscriptionDto } from './dto/change-subscription.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { Subscription } from './subscription.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plan limit field → the Hotel usage counter it constrains. */
const LIMIT_USAGE_FIELDS = [
  { limit: 'maxRooms', usage: 'roomsCount', label: 'rooms' },
  { limit: 'maxStaffUsers', usage: 'staffUsersCount', label: 'staff users' },
  {
    limit: 'maxGuestRequestsPerMonth',
    usage: 'monthlyGuestRequests',
    label: 'guest requests per month',
  },
] as const;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subsRepo: Repository<Subscription>,
    @InjectRepository(Plan) private readonly plansRepo: Repository<Plan>,
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Story 4.6 — current subscription + usage vs limits + history. */
  async getForHotel(hotelId: string) {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundException('Hotel not found');

    const current = await this.subsRepo.findOne({
      where: { hotelId, endDate: IsNull() },
      relations: ['plan'],
    });
    const history = await this.subsRepo.find({
      where: { hotelId, endDate: Not(IsNull()) },
      relations: ['plan'],
      order: { startDate: 'DESC' },
    });

    return {
      current: current
        ? {
            ...current,
            daysRemaining:
              current.status === 'trial' && current.trialEndsAt
                ? this.daysUntil(current.trialEndsAt)
                : null,
          }
        : null,
      usage: current ? this.computeUsage(hotel, current.plan) : null,
      history: history.map((sub) => ({
        id: sub.id,
        planId: sub.planId,
        planNameEn: sub.plan?.nameEn ?? null,
        planNameAr: sub.plan?.nameAr ?? null,
        billingCycle: sub.billingCycle,
        status: sub.status,
        startDate: sub.startDate,
        endDate: sub.endDate,
      })),
    };
  }

  /** Stories 4.7 / 4.9 / 4.10 — plan change, trial assignment, conversion. */
  async changePlan(
    hotelId: string,
    dto: ChangeSubscriptionDto,
    actor: Admin,
  ): Promise<Subscription> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundException('Hotel not found');

    const plan = await this.plansRepo.findOne({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== 'active') {
      throw new ConflictException('Archived plans cannot be selected');
    }
    if (dto.billingCycle === 'yearly' && plan.yearlyPrice === null) {
      throw new BadRequestException(
        'Yearly billing is unavailable for this plan',
      );
    }

    const force = dto.force === true;
    if (force && !this.isWildcard(actor)) {
      throw new ForbiddenException(
        'Only Super Admin (*) can force a plan change',
      );
    }

    if (!force) this.assertUsageWithinLimits(hotel, plan);
    if (plan.isTrial) await this.assertTrialUnused(hotelId, force);

    const current = await this.subsRepo.findOne({
      where: { hotelId, endDate: IsNull() },
    });
    const now = new Date();
    if (current) {
      current.endDate = now;
      await this.subsRepo.save(current);
    }

    const subscription = await this.subsRepo.save(
      this.subsRepo.create({
        hotelId,
        planId: plan.id,
        billingCycle: dto.billingCycle,
        status: plan.isTrial ? 'trial' : 'active',
        startDate: now,
        endDate: null,
        nextRenewalAt: plan.isTrial
          ? null
          : this.addCycle(now, dto.billingCycle),
        trialEndsAt: plan.isTrial
          ? new Date(now.getTime() + (plan.trialDurationDays ?? 0) * DAY_MS)
          : null,
        changedById: actor.id,
      }),
    );

    await this.auditLogs.log({
      action: 'subscription.changed',
      entityType: 'subscription',
      entityId: subscription.id,
      actorId: actor.id,
      metadata: {
        hotelId,
        oldPlanId: current?.planId ?? null,
        newPlanId: plan.id,
        billingCycle: dto.billingCycle,
        force,
      },
    });
    return subscription;
  }

  /**
   * Epic 05 (Story 5.3 AC4/AC6) — first subscription for a brand-new hotel,
   * created inside the onboarding transaction via the caller's EntityManager.
   * Unlike changePlan there is no current subscription to close and no trial
   * history to check. No audit here — onboarding logs `hotel.created`.
   */
  async createInitialSubscription(
    manager: EntityManager,
    hotel: Hotel,
    opts: { planId: string; billingCycle?: 'monthly' | 'yearly' },
    actor: Admin,
  ): Promise<Subscription> {
    const plan = await this.plansRepo.findOne({ where: { id: opts.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== 'active') {
      throw new ConflictException('Archived plans cannot be selected');
    }
    if (!plan.isTrial && !opts.billingCycle) {
      throw new BadRequestException(
        'Billing cycle is required for paid plans',
      );
    }
    if (opts.billingCycle === 'yearly' && plan.yearlyPrice === null) {
      throw new BadRequestException(
        'Yearly billing is unavailable for this plan',
      );
    }
    this.assertUsageWithinLimits(hotel, plan);

    const now = new Date();
    const billingCycle = plan.isTrial ? 'monthly' : opts.billingCycle!;
    const repo = manager.getRepository(Subscription);
    return repo.save(
      repo.create({
        hotelId: hotel.id,
        planId: plan.id,
        billingCycle,
        status: plan.isTrial ? 'trial' : 'active',
        startDate: now,
        endDate: null,
        nextRenewalAt: plan.isTrial ? null : this.addCycle(now, billingCycle),
        trialEndsAt: plan.isTrial
          ? new Date(now.getTime() + (plan.trialDurationDays ?? 0) * DAY_MS)
          : null,
        changedById: actor.id,
      }),
    );
  }

  /** Story 4.10 AC6 — Super Admin (*) only. */
  async extendTrial(
    hotelId: string,
    dto: ExtendTrialDto,
    actor: Admin,
  ): Promise<Subscription> {
    if (!this.isWildcard(actor)) {
      throw new ForbiddenException('Only Super Admin (*) can extend a trial');
    }
    const current = await this.subsRepo.findOne({
      where: { hotelId, endDate: IsNull() },
    });
    if (!current || current.status !== 'trial' || !current.trialEndsAt) {
      throw new ConflictException('Hotel has no running trial to extend');
    }
    const oldTrialEndsAt = current.trialEndsAt;
    current.trialEndsAt = new Date(
      oldTrialEndsAt.getTime() + dto.additionalDays * DAY_MS,
    );
    const saved = await this.subsRepo.save(current);
    await this.auditLogs.log({
      action: 'subscription.trial_extended',
      entityType: 'subscription',
      entityId: current.id,
      actorId: actor.id,
      metadata: {
        hotelId,
        additionalDays: dto.additionalDays,
        oldTrialEndsAt: oldTrialEndsAt.toISOString(),
        newTrialEndsAt: saved.trialEndsAt!.toISOString(),
      },
    });
    return saved;
  }

  /**
   * Story 4.10 AC1 — daily job body. Overdue trials flip to `expired`; the
   * row stays current (endDate null) until an admin converts the hotel.
   */
  async expireOverdueTrials(): Promise<number> {
    const overdue = await this.subsRepo.find({
      where: { status: 'trial', trialEndsAt: LessThan(new Date()) },
    });
    for (const sub of overdue) {
      sub.status = 'expired';
      await this.subsRepo.save(sub);
      await this.auditLogs.log({
        action: 'subscription.expired',
        entityType: 'subscription',
        entityId: sub.id,
        actorId: null,
        metadata: { hotelId: sub.hotelId, trialEndsAt: sub.trialEndsAt },
      });
    }
    if (overdue.length > 0) {
      this.logger.log(`Expired ${overdue.length} overdue trial(s)`);
    }
    return overdue.length;
  }

  private isWildcard(actor: Admin): boolean {
    return actor.role?.permissions?.includes(WILDCARD) ?? false;
  }

  /** Downgrade guard (SA-SUB-2): 409 detailing each violated limit. */
  private assertUsageWithinLimits(hotel: Hotel, plan: Plan) {
    const violations = LIMIT_USAGE_FIELDS.filter(({ limit, usage }) => {
      const max = plan[limit];
      return max !== null && hotel[usage] > max;
    }).map(({ limit, usage, label }) => ({
      hotelId: hotel.id,
      hotelName: hotel.nameEn,
      field: limit,
      usage: hotel[usage],
      limit: plan[limit] as number,
      message: `Hotel has ${hotel[usage]} ${label}; target plan allows ${plan[limit]}`,
    }));
    if (violations.length > 0) {
      throw new ConflictException({
        message: `Hotel usage exceeds ${violations.length} limit(s) of the target plan`,
        violations,
      });
    }
  }

  /** One trial per hotel, ever (SA-SUB-2). */
  private async assertTrialUnused(hotelId: string, force: boolean) {
    if (force) return;
    const priorTrial = await this.subsRepo.findOne({
      where: { hotelId, trialEndsAt: Not(IsNull()) },
    });
    if (priorTrial) throw new ConflictException('Trial already used');
  }

  private addCycle(from: Date, cycle: 'monthly' | 'yearly'): Date {
    const next = new Date(from);
    if (cycle === 'monthly') next.setMonth(next.getMonth() + 1);
    else next.setFullYear(next.getFullYear() + 1);
    return next;
  }

  private computeUsage(hotel: Hotel, plan: Plan | undefined) {
    if (!plan) return null;
    return LIMIT_USAGE_FIELDS.map(({ limit, usage, label }) => {
      const max = plan[limit];
      return {
        field: limit,
        label,
        used: hotel[usage],
        max,
        pct: max === null ? null : Math.round((hotel[usage] / max) * 100),
      };
    });
  }

  private daysUntil(date: Date): number {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
  }
}
