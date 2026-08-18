import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Plan } from '../plans/plan.entity';
import { Role } from '../roles/role.entity';
import { Subscription } from './subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subsRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let plansRepo: { findOne: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let events: { emitAsync: jest.Mock };

  const superAdmin = {
    id: 'admin-1',
    role: { permissions: ['*'] } as Role,
  } as Admin;
  const regularAdmin = {
    id: 'admin-2',
    role: { permissions: ['subscriptions.update'] } as Role,
  } as Admin;

  const makeHotel = (overrides: Partial<Hotel> = {}): Hotel =>
    ({
      id: 'hotel-1',
      nameEn: 'Nile Grand',
      nameAr: 'نايل جراند',
      slug: 'nile-grand',
      status: 'active',
      roomsCount: 80,
      staffUsersCount: 12,
      monthlyGuestRequests: 500,
      ...overrides,
    }) as Hotel;

  const makePlan = (overrides: Partial<Plan> = {}): Plan =>
    ({
      id: 'plan-1',
      nameEn: 'Standard',
      nameAr: 'الأساسية',
      monthlyPrice: 100,
      yearlyPrice: 1000,
      currency: 'EGP',
      maxRooms: null,
      maxStaffUsers: null,
      maxGuestRequestsPerMonth: null,
      enabledModules: ['transportation'],
      status: 'active',
      isTrial: false,
      trialDurationDays: null,
      ...overrides,
    }) as Plan;

  const makeSub = (overrides: Partial<Subscription> = {}): Subscription =>
    ({
      id: 'sub-1',
      hotelId: 'hotel-1',
      planId: 'plan-0',
      billingCycle: 'monthly',
      status: 'active',
      startDate: new Date('2026-06-01'),
      endDate: null,
      nextRenewalAt: new Date('2026-08-01'),
      trialEndsAt: null,
      ...overrides,
    }) as Subscription;

  beforeEach(async () => {
    subsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (s) => ({ id: s.id ?? 'sub-new', ...s })),
    };
    plansRepo = { findOne: jest.fn() };
    hotelsRepo = { findOne: jest.fn().mockResolvedValue(makeHotel()) };
    auditLogs = { log: jest.fn() };
    events = { emitAsync: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(Subscription), useValue: subsRepo },
        { provide: getRepositoryToken(Plan), useValue: plansRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionsService);
  });

  describe('getForHotel (SA-SUB-1)', () => {
    it('returns 404 for an unknown hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(service.getForHotel('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns current subscription, usage vs limits, and history', async () => {
      const plan = makePlan({ maxRooms: 100, maxStaffUsers: 15 });
      subsRepo.findOne.mockResolvedValue(makeSub({ plan, planId: plan.id }));
      subsRepo.find.mockResolvedValue([
        makeSub({
          id: 'sub-old',
          endDate: new Date('2026-06-01'),
          plan: makePlan({ id: 'plan-old', nameEn: 'Old' }),
        }),
      ]);

      const result = await service.getForHotel('hotel-1');

      expect(result.current?.status).toBe('active');
      expect(result.usage).toEqual([
        expect.objectContaining({ field: 'maxRooms', used: 80, max: 100, pct: 80 }),
        expect.objectContaining({ field: 'maxStaffUsers', used: 12, max: 15, pct: 80 }),
        expect.objectContaining({ field: 'maxGuestRequestsPerMonth', used: 500, max: null, pct: null }),
      ]);
      expect(result.history).toEqual([
        expect.objectContaining({ id: 'sub-old', planNameEn: 'Old' }),
      ]);
    });

    it('includes daysRemaining for a running trial (SA-SUB-4 visibility)', async () => {
      const plan = makePlan({ isTrial: true, trialDurationDays: 14 });
      subsRepo.findOne.mockResolvedValue(
        makeSub({
          plan,
          status: 'trial',
          trialEndsAt: new Date(Date.now() + 3 * DAY_MS),
          nextRenewalAt: null,
        }),
      );

      const result = await service.getForHotel('hotel-1');
      expect(result.current?.daysRemaining).toBe(3);
    });

    it('returns null current and usage when the hotel has no subscription', async () => {
      subsRepo.findOne.mockResolvedValue(null);
      const result = await service.getForHotel('hotel-1');
      expect(result.current).toBeNull();
      expect(result.usage).toBeNull();
    });
  });

  describe('changePlan (SA-SUB-2)', () => {
    const dto = { planId: 'plan-1', billingCycle: 'monthly' as const };

    it('rejects an archived target plan with 409', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ status: 'archived' }));
      await expect(
        service.changePlan('hotel-1', dto, regularAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects yearly billing when the plan has no yearly price', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ yearlyPrice: null }));
      await expect(
        service.changePlan(
          'hotel-1',
          { ...dto, billingCycle: 'yearly' },
          regularAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 409 detailing each violated limit on downgrade', async () => {
      plansRepo.findOne.mockResolvedValue(
        makePlan({ maxRooms: 50, maxStaffUsers: 5 }),
      );

      await expect(
        service.changePlan('hotel-1', dto, regularAdmin),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          violations: [
            expect.objectContaining({ field: 'maxRooms', usage: 80, limit: 50 }),
            expect.objectContaining({ field: 'maxStaffUsers', usage: 12, limit: 5 }),
          ],
        }),
      });
    });

    it('rejects force from a non-wildcard admin with 403', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ maxRooms: 50 }));
      await expect(
        service.changePlan('hotel-1', { ...dto, force: true }, regularAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a wildcard admin force past the downgrade guard, audit-logged', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ maxRooms: 50 }));

      const sub = await service.changePlan(
        'hotel-1',
        { ...dto, force: true },
        superAdmin,
      );

      expect(sub.status).toBe('active');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.changed',
          metadata: expect.objectContaining({ force: true }),
        }),
      );
    });

    it('closes the previous subscription and creates a new row (no overwrite)', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      const current = makeSub({ planId: 'plan-0' });
      subsRepo.findOne.mockResolvedValue(current);

      const created = await service.changePlan('hotel-1', dto, regularAdmin);

      expect(current.endDate).toBeInstanceOf(Date);
      expect(subsRepo.save).toHaveBeenCalledWith(current);
      expect(created.id).not.toBe(current.id);
      expect(created.planId).toBe('plan-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.changed',
          actorId: 'admin-2',
          metadata: expect.objectContaining({
            oldPlanId: 'plan-0',
            newPlanId: 'plan-1',
          }),
        }),
      );
    });

    it('creates the first subscription without closing anything', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.findOne.mockResolvedValue(null);

      const created = await service.changePlan('hotel-1', dto, regularAdmin);

      expect(created.status).toBe('active');
      expect(created.nextRenewalAt).toBeInstanceOf(Date);
      expect(subsRepo.save).toHaveBeenCalledTimes(1);
    });

    it('creates trial subscriptions with trialEndsAt = start + duration and no renewal', async () => {
      plansRepo.findOne.mockResolvedValue(
        makePlan({ isTrial: true, trialDurationDays: 14, monthlyPrice: 0 }),
      );

      const created = await service.changePlan('hotel-1', dto, regularAdmin);

      expect(created.status).toBe('trial');
      expect(created.nextRenewalAt).toBeNull();
      const expectedEnd = created.startDate.getTime() + 14 * DAY_MS;
      expect(created.trialEndsAt?.getTime()).toBe(expectedEnd);
    });

    it('rejects a second trial for a hotel that ever had one (409 Trial already used)', async () => {
      plansRepo.findOne.mockResolvedValue(
        makePlan({ isTrial: true, trialDurationDays: 14 }),
      );
      subsRepo.findOne.mockResolvedValueOnce(
        makeSub({ trialEndsAt: new Date('2026-05-01'), endDate: new Date() }),
      );

      await expect(
        service.changePlan('hotel-1', dto, regularAdmin),
      ).rejects.toThrow(new ConflictException('Trial already used'));
    });

    it('lets a wildcard admin force a repeated trial, audit-logged', async () => {
      plansRepo.findOne.mockResolvedValue(
        makePlan({ isTrial: true, trialDurationDays: 14 }),
      );

      const created = await service.changePlan(
        'hotel-1',
        { ...dto, force: true },
        superAdmin,
      );

      expect(created.status).toBe('trial');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ force: true }),
        }),
      );
    });

    it('converts an expired trial to a paid plan: active status, trial row closed', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      const expiredTrial = makeSub({
        status: 'expired',
        trialEndsAt: new Date('2026-07-01'),
        nextRenewalAt: null,
      });
      subsRepo.findOne.mockResolvedValue(expiredTrial);

      const created = await service.changePlan('hotel-1', dto, regularAdmin);

      expect(expiredTrial.endDate).toBeInstanceOf(Date);
      expect(created.status).toBe('active');
      expect(created.nextRenewalAt).toBeInstanceOf(Date);
    });

    it('returns 404 for an unknown hotel or plan', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.changePlan('missing', dto, regularAdmin),
      ).rejects.toThrow(NotFoundException);

      hotelsRepo.findOne.mockResolvedValue(makeHotel());
      plansRepo.findOne.mockResolvedValue(null);
      await expect(
        service.changePlan('hotel-1', dto, regularAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('downgrade guard (11.6 AC3)', () => {
    const dto = { planId: 'plan-1', billingCycle: 'monthly' as const };

    it('AC3 — target maxRooms below hotel.roomsCount (derived) → 409 PLAN_LIMIT_VIOLATION with field maxRooms', async () => {
      // roomsCount is no longer the Epic 05 manual field — Tasks 4-6 keep it
      // live from actual rooms, so this guard is now genuinely derived-vs-plan.
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ roomsCount: 80 }));
      plansRepo.findOne.mockResolvedValue(makePlan({ maxRooms: 50 }));

      await expect(
        service.changePlan('hotel-1', dto, regularAdmin),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PLAN_LIMIT_VIOLATION',
          violations: expect.arrayContaining([
            expect.objectContaining({ field: 'maxRooms', usage: 80, limit: 50 }),
          ]),
        }),
      });
    });

    it('AC1 — computeUsage reads the derived counter for the rooms row', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ roomsCount: 42 }));
      const plan = makePlan({ maxRooms: 100 });
      subsRepo.findOne.mockResolvedValue(makeSub({ plan, planId: plan.id }));

      const result = await service.getForHotel('hotel-1');

      expect(result.usage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'maxRooms', used: 42, max: 100, pct: 42 }),
        ]),
      );
    });
  });

  describe('extendTrial (SA-SUB-3)', () => {
    it('rejects non-wildcard admins with 403', async () => {
      await expect(
        service.extendTrial('hotel-1', { additionalDays: 7 }, regularAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the current subscription is not a running trial', async () => {
      subsRepo.findOne.mockResolvedValue(makeSub({ status: 'active' }));
      await expect(
        service.extendTrial('hotel-1', { additionalDays: 7 }, superAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('extends trialEndsAt and audits old/new dates', async () => {
      const trialEndsAt = new Date('2026-08-01T00:00:00Z');
      subsRepo.findOne.mockResolvedValue(
        makeSub({ status: 'trial', trialEndsAt, nextRenewalAt: null }),
      );

      const saved = await service.extendTrial(
        'hotel-1',
        { additionalDays: 7 },
        superAdmin,
      );

      expect(saved.trialEndsAt?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.trial_extended',
          actorId: 'admin-1',
          metadata: expect.objectContaining({
            oldTrialEndsAt: '2026-08-01T00:00:00.000Z',
            newTrialEndsAt: '2026-08-08T00:00:00.000Z',
          }),
        }),
      );
    });
  });

  describe('createInitialSubscription (SA-HTL-3)', () => {
    let managerRepo: { create: jest.Mock; save: jest.Mock };
    let manager: { getRepository: jest.Mock };

    beforeEach(() => {
      managerRepo = {
        create: jest.fn((data) => data),
        save: jest.fn(async (s) => ({ id: 'sub-new', ...s })),
      };
      manager = { getRepository: jest.fn(() => managerRepo) };
    });

    const call = (planOverrides: Partial<Plan>, opts: Record<string, unknown>) => {
      plansRepo.findOne.mockResolvedValue(makePlan(planOverrides));
      return service.createInitialSubscription(
        manager as never,
        makeHotel(),
        opts as never,
        superAdmin,
      );
    };

    it('creates a trial subscription with trialEndsAt = now + duration', async () => {
      const before = Date.now();
      const sub = await call(
        { isTrial: true, trialDurationDays: 14, monthlyPrice: 0 },
        { planId: 'plan-1' },
      );

      expect(manager.getRepository).toHaveBeenCalledWith(Subscription);
      expect(sub.status).toBe('trial');
      expect(sub.billingCycle).toBe('monthly');
      expect(sub.nextRenewalAt).toBeNull();
      const expected = before + 14 * DAY_MS;
      expect(sub.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(expected);
      expect(sub.trialEndsAt!.getTime()).toBeLessThan(expected + 5000);
      // Onboarding logs the umbrella hotel.created — no audit entry here.
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('creates an active paid subscription with a renewal date', async () => {
      const sub = await call({}, { planId: 'plan-1', billingCycle: 'yearly' });

      expect(sub.status).toBe('active');
      expect(sub.trialEndsAt).toBeNull();
      expect(sub.nextRenewalAt).not.toBeNull();
    });

    it('requires a billing cycle for paid plans', async () => {
      await expect(call({}, { planId: 'plan-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects archived plans with 409', async () => {
      await expect(
        call({ status: 'archived' }, { planId: 'plan-1', billingCycle: 'monthly' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects yearly billing when the plan has no yearly price', async () => {
      await expect(
        call({ yearlyPrice: null }, { planId: 'plan-1', billingCycle: 'yearly' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces usage-vs-limit guards (rooms entered in step 1)', async () => {
      await expect(
        call({ maxRooms: 50 }, { planId: 'plan-1', billingCycle: 'monthly' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          violations: [
            expect.objectContaining({ field: 'maxRooms', usage: 80, limit: 50 }),
          ],
        }),
      });
      expect(managerRepo.save).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown plan', async () => {
      plansRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createInitialSubscription(
          manager as never,
          makeHotel(),
          { planId: 'missing', billingCycle: 'monthly' },
          superAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('trial countdown emission (6.5)', () => {
    const runningTrial = (daysFromNow: number, overrides: Partial<Subscription> = {}) =>
      makeSub({
        status: 'trial',
        trialEndsAt: new Date(Date.now() + daysFromNow * DAY_MS),
        nextRenewalAt: null,
        ...overrides,
      });

    it.each([[7], [3], [1]])(
      'emits the %i-day threshold at exactly %i days remaining',
      async (days) => {
        subsRepo.find.mockResolvedValue([runningTrial(days - 0.5)]);

        const emitted = await service.emitTrialCountdowns();

        expect(emitted).toBe(1);
        expect(events.emitAsync).toHaveBeenCalledWith(
          'subscription.trial_countdown',
          expect.objectContaining({ subscriptionId: 'sub-1', threshold: days }),
        );
      },
    );

    it('catches up a missed run: 6 days remaining still emits the 7-day notice (AC2)', async () => {
      subsRepo.find.mockResolvedValue([runningTrial(5.5)]);

      await service.emitTrialCountdowns();

      // The notice tier is 7 (dedupe key), but the email must show the
      // actual days left — never claim "7 days" when 6 remain.
      expect(events.emitAsync).toHaveBeenCalledWith(
        'subscription.trial_countdown',
        expect.objectContaining({ threshold: 7, daysRemaining: 6 }),
      );
    });

    it('emits only the smallest applicable threshold: 2 days remaining → 3, never 7', async () => {
      subsRepo.find.mockResolvedValue([runningTrial(1.5)]);

      await service.emitTrialCountdowns();

      expect(events.emitAsync).toHaveBeenCalledTimes(1);
      expect(events.emitAsync).toHaveBeenCalledWith(
        'subscription.trial_countdown',
        expect.objectContaining({ threshold: 3 }),
      );
    });

    it('emits nothing for trials with more than 7 days remaining', async () => {
      subsRepo.find.mockResolvedValue([runningTrial(10)]);

      const emitted = await service.emitTrialCountdowns();

      expect(emitted).toBe(0);
      expect(events.emitAsync).not.toHaveBeenCalled();
    });

    it('queries only running (non-ended, future) trials — overdue ones get the expiry notice instead', async () => {
      subsRepo.find.mockResolvedValue([]);

      await service.emitTrialCountdowns();

      const where = subsRepo.find.mock.calls[0][0].where;
      expect(where.status).toBe('trial');
      expect(where.endDate).toBeDefined();
      expect(where.trialEndsAt).toBeDefined();
    });

    it('carries the (new) trialEndsAt in the payload so an extension re-arms thresholds (AC4)', async () => {
      const extendedEnd = new Date(Date.now() + 6 * DAY_MS);
      subsRepo.find.mockResolvedValue([
        runningTrial(6, { trialEndsAt: extendedEnd }),
      ]);

      await service.emitTrialCountdowns();

      // The listener keys dedupe on threshold + this date: a new trialEndsAt
      // yields new keys, so 7/3/1 all apply again after an extension.
      expect(events.emitAsync).toHaveBeenCalledWith(
        'subscription.trial_countdown',
        expect.objectContaining({ threshold: 7, trialEndsAt: extendedEnd }),
      );
    });
  });

  describe('expireOverdueTrials (SA-SUB-4)', () => {
    it('flips overdue trials to expired, keeps the row current, audits with null actor', async () => {
      const overdue = makeSub({
        status: 'trial',
        trialEndsAt: new Date(Date.now() - DAY_MS),
        nextRenewalAt: null,
      });
      subsRepo.find.mockResolvedValue([overdue]);

      const count = await service.expireOverdueTrials();

      expect(count).toBe(1);
      expect(overdue.status).toBe('expired');
      expect(overdue.endDate).toBeNull();
      expect(subsRepo.save).toHaveBeenCalledWith(overdue);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.expired',
          actorId: null,
        }),
      );
      // Story 6.5 AC3 — expiry notice event per flipped subscription.
      expect(events.emitAsync).toHaveBeenCalledWith(
        'subscription.trial_expired',
        expect.objectContaining({ subscriptionId: 'sub-1', hotelId: 'hotel-1' }),
      );
    });

    it('queries only running trials past their end date', async () => {
      subsRepo.find.mockResolvedValue([]);

      const count = await service.expireOverdueTrials();

      expect(count).toBe(0);
      const where = subsRepo.find.mock.calls[0][0].where;
      expect(where.status).toBe('trial');
      expect(where.trialEndsAt).toBeDefined();
      expect(subsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });
});
