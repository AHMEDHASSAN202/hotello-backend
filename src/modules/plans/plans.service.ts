import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Subscription } from '../subscriptions/subscription.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import {
  ALL_MODULE_KEYS,
  MODULE_CATALOG,
  ModuleCatalogEntry,
} from './modules.constants';
import { Plan } from './plan.entity';

/** Plan limit field → the Hotel usage counter it constrains. */
const LIMIT_USAGE_FIELDS = [
  { limit: 'maxRooms', usage: 'roomsCount' },
  { limit: 'maxStaffUsers', usage: 'staffUsersCount' },
  { limit: 'maxGuestRequestsPerMonth', usage: 'monthlyGuestRequests' },
] as const;

export interface LimitViolation {
  hotelId: string;
  hotelName: string;
  field: string;
  usage: number;
  limit: number;
}

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly plansRepo: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subsRepo: Repository<Subscription>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  getModuleCatalog(): ModuleCatalogEntry[] {
    return MODULE_CATALOG;
  }

  async findAll(query: ListPlansQueryDto = {}) {
    const status = query.status ?? 'all';
    const plans = await this.plansRepo.find({
      where: status === 'all' ? {} : { status },
      order: { createdAt: 'ASC' },
    });
    const withCounts = await Promise.all(
      plans.map(async (plan) => ({
        ...plan,
        subscriberCount: await this.countCurrentSubscribers(plan.id),
      })),
    );
    return this.sortPlans(withCounts, query);
  }

  async findOne(id: string) {
    const plan = await this.plansRepo.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return {
      ...plan,
      subscriberCount: await this.countCurrentSubscribers(id),
    };
  }

  async findSubscribers(id: string) {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    const subs = await this.subsRepo.find({
      where: { planId: id, endDate: IsNull() },
      relations: ['hotel'],
      order: { startDate: 'DESC' },
    });
    return subs.map((sub) => ({
      hotelId: sub.hotelId,
      hotelName: sub.hotel?.nameEn ?? null,
      startDate: sub.startDate,
      billingCycle: sub.billingCycle,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      daysRemaining:
        sub.status === 'trial' && sub.trialEndsAt
          ? this.daysUntil(sub.trialEndsAt)
          : null,
    }));
  }

  async create(dto: CreatePlanDto, actor: Admin): Promise<Plan> {
    this.assertKnownModules(dto.enabledModules);
    await this.assertNamesAvailable(dto.nameEn, dto.nameAr);
    if (dto.isTrial) {
      if (!dto.trialDurationDays) {
        throw new BadRequestException(
          'trialDurationDays is required for trial plans',
        );
      }
      await this.assertSingleActiveTrial();
    }
    const plan = await this.plansRepo.save(
      this.plansRepo.create({
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        descriptionEn: dto.descriptionEn ?? null,
        descriptionAr: dto.descriptionAr ?? null,
        monthlyPrice: dto.monthlyPrice,
        yearlyPrice: dto.yearlyPrice ?? null,
        currency: dto.currency ?? 'EGP',
        maxRooms: dto.maxRooms ?? null,
        maxStaffUsers: dto.maxStaffUsers ?? null,
        maxGuestRequestsPerMonth: dto.maxGuestRequestsPerMonth ?? null,
        enabledModules: dto.enabledModules,
        status: 'active',
        isTrial: dto.isTrial ?? false,
        trialDurationDays: dto.trialDurationDays ?? null,
        createdById: actor.id,
      }),
    );
    await this.auditLogs.log({
      action: 'plan.created',
      entityType: 'plan',
      entityId: plan.id,
      actorId: actor.id,
      metadata: { nameEn: plan.nameEn },
    });
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, actor: Admin): Promise<Plan> {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');

    if (dto.enabledModules) this.assertKnownModules(dto.enabledModules);
    await this.assertNamesAvailable(
      dto.nameEn && dto.nameEn.toLowerCase() !== plan.nameEn.toLowerCase()
        ? dto.nameEn
        : undefined,
      dto.nameAr && dto.nameAr.toLowerCase() !== plan.nameAr.toLowerCase()
        ? dto.nameAr
        : undefined,
      id,
    );
    if (dto.isTrial === true && !plan.isTrial) {
      if (!(dto.trialDurationDays ?? plan.trialDurationDays)) {
        throw new BadRequestException(
          'trialDurationDays is required for trial plans',
        );
      }
      if (plan.status === 'active') await this.assertSingleActiveTrial(id);
    }

    await this.assertNoLimitViolations(plan, dto);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      const current = (plan as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(current) !== JSON.stringify(value)) {
        before[key] = current;
        after[key] = value;
      }
    }

    Object.assign(plan, dto);
    const saved = await this.plansRepo.save(plan);
    await this.auditLogs.log({
      action: 'plan.updated',
      entityType: 'plan',
      entityId: id,
      actorId: actor.id,
      metadata: { before, after },
    });
    return saved;
  }

  async archive(id: string, actor: Admin): Promise<Plan> {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status === 'archived') {
      throw new ConflictException('Plan is already archived');
    }
    const subscriberCount = await this.countCurrentSubscribers(id);
    if (subscriberCount > 0) {
      throw new ConflictException({
        message: `Plan has ${subscriberCount} subscribed hotel(s). Migrate them to another plan first.`,
        subscriberCount,
      });
    }
    plan.status = 'archived';
    const saved = await this.plansRepo.save(plan);
    await this.auditLogs.log({
      action: 'plan.archived',
      entityType: 'plan',
      entityId: id,
      actorId: actor.id,
    });
    return saved;
  }

  async restore(id: string, actor: Admin): Promise<Plan> {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status === 'active') {
      throw new ConflictException('Plan is already active');
    }
    if (plan.isTrial) await this.assertSingleActiveTrial(id);
    plan.status = 'active';
    const saved = await this.plansRepo.save(plan);
    await this.auditLogs.log({
      action: 'plan.restored',
      entityType: 'plan',
      entityId: id,
      actorId: actor.id,
    });
    return saved;
  }

  private async countCurrentSubscribers(planId: string): Promise<number> {
    return this.subsRepo.count({ where: { planId, endDate: IsNull() } });
  }

  private sortPlans<T extends Plan & { subscriberCount: number }>(
    plans: T[],
    query: ListPlansQueryDto,
  ): T[] {
    if (!query.sortBy) return plans;
    const dir = query.sortDir === 'desc' ? -1 : 1;
    const key = query.sortBy;
    return [...plans].sort((a, b) => {
      if (key === 'name') return a.nameEn.localeCompare(b.nameEn) * dir;
      if (key === 'monthlyPrice') return (a.monthlyPrice - b.monthlyPrice) * dir;
      if (key === 'subscriberCount')
        return (a.subscriberCount - b.subscriberCount) * dir;
      return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
    });
  }

  /** Free-text module names are rejected with 422 (SA-PLAN-3). */
  private assertKnownModules(modules: string[]) {
    const invalid = modules.filter((key) => !ALL_MODULE_KEYS.includes(key));
    if (invalid.length > 0) {
      throw new UnprocessableEntityException(
        `Unknown module keys: ${invalid.join(', ')}`,
      );
    }
  }

  /** Case-insensitive per-language name uniqueness. */
  private async assertNamesAvailable(
    nameEn?: string,
    nameAr?: string,
    excludeId?: string,
  ) {
    const checks: Array<['nameEn' | 'nameAr', string]> = [];
    if (nameEn) checks.push(['nameEn', nameEn]);
    if (nameAr) checks.push(['nameAr', nameAr]);
    for (const [field, value] of checks) {
      const existing = await this.plansRepo.findOne({
        where: excludeId
          ? { [field]: ILike(value), id: Not(excludeId) }
          : { [field]: ILike(value) },
      });
      if (existing) {
        throw new ConflictException(`Plan name already in use (${field})`);
      }
    }
  }

  /** Exactly one active trial plan may exist at a time (SA-PLAN-3). */
  private async assertSingleActiveTrial(excludeId?: string) {
    const existing = await this.plansRepo.findOne({
      where: excludeId
        ? { isTrial: true, status: 'active', id: Not(excludeId) }
        : { isTrial: true, status: 'active' },
    });
    if (existing) {
      throw new ConflictException(
        `An active trial plan already exists ("${existing.nameEn}")`,
      );
    }
  }

  /**
   * Downgrade guard (SA-PLAN-4): a limit may not be tightened below a current
   * subscriber's actual usage. 409 lists every violating tenant.
   */
  private async assertNoLimitViolations(plan: Plan, dto: UpdatePlanDto) {
    const tightened = LIMIT_USAGE_FIELDS.filter(({ limit }) => {
      if (!(limit in dto)) return false;
      const next = dto[limit];
      if (next === null || next === undefined) return false; // loosening to unlimited
      const current = plan[limit];
      return current === null || next < current;
    });
    if (tightened.length === 0) return;

    const subs = await this.subsRepo.find({
      where: { planId: plan.id, endDate: IsNull() },
      relations: ['hotel'],
    });
    const violations: LimitViolation[] = [];
    for (const sub of subs) {
      if (!sub.hotel) continue;
      for (const { limit, usage } of tightened) {
        const nextLimit = dto[limit] as number;
        const used = sub.hotel[usage];
        if (used > nextLimit) {
          violations.push({
            hotelId: sub.hotel.id,
            hotelName: sub.hotel.nameEn,
            field: limit,
            usage: used,
            limit: nextLimit,
          });
        }
      }
    }
    if (violations.length > 0) {
      throw new ConflictException({
        message: `New limits are below the current usage of ${new Set(violations.map((v) => v.hotelId)).size} hotel(s)`,
        violations,
      });
    }
  }

  private daysUntil(date: Date): number {
    return Math.max(
      0,
      Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
  }
}
