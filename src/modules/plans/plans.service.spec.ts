import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Subscription } from '../subscriptions/subscription.entity';
import { MODULE_CATALOG } from './modules.constants';
import { Plan } from './plan.entity';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  let plansRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let subsRepo: { find: jest.Mock; count: jest.Mock };
  let auditLogs: { log: jest.Mock };

  const actor = { id: 'admin-1' } as Admin;

  const makePlan = (overrides: Partial<Plan> = {}): Plan =>
    ({
      id: 'plan-1',
      nameEn: 'Standard',
      nameAr: 'الأساسية',
      descriptionEn: null,
      descriptionAr: null,
      monthlyPrice: 100,
      yearlyPrice: 1000,
      currency: 'EGP',
      maxRooms: 100,
      maxStaffUsers: 20,
      maxGuestRequestsPerMonth: null,
      enabledModules: ['transportation', 'fnb'],
      status: 'active',
      isTrial: false,
      trialDurationDays: null,
      createdById: 'admin-1',
      createdAt: new Date('2026-01-01'),
      ...overrides,
    }) as Plan;

  const makeSub = (overrides: Partial<Subscription> = {}): Subscription =>
    ({
      id: 'sub-1',
      hotelId: 'hotel-1',
      planId: 'plan-1',
      billingCycle: 'monthly',
      status: 'active',
      startDate: new Date('2026-06-01'),
      endDate: null,
      trialEndsAt: null,
      hotel: {
        id: 'hotel-1',
        nameEn: 'Nile Grand',
        roomsCount: 80,
        staffUsersCount: 12,
        monthlyGuestRequests: 500,
      } as Hotel,
      ...overrides,
    }) as Subscription;

  beforeEach(async () => {
    plansRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (p) => ({ id: 'plan-1', ...p })),
    };
    subsRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getRepositoryToken(Plan), useValue: plansRepo },
        { provide: getRepositoryToken(Subscription), useValue: subsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = moduleRef.get(PlansService);
  });

  describe('findAll (SA-PLAN-1)', () => {
    it('returns plans with a live subscriber count each', async () => {
      plansRepo.find.mockResolvedValue([makePlan(), makePlan({ id: 'plan-2' })]);
      subsRepo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

      const result = await service.findAll();

      expect(result.map((p) => p.subscriberCount)).toEqual([3, 0]);
    });

    it('filters by status', async () => {
      plansRepo.find.mockResolvedValue([]);
      await service.findAll({ status: 'archived' });
      expect(plansRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'archived' } }),
      );
    });

    it('defaults to no status filter (all)', async () => {
      plansRepo.find.mockResolvedValue([]);
      await service.findAll();
      expect(plansRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('sorts by name, price and subscriberCount in both directions', async () => {
      const a = makePlan({ id: 'a', nameEn: 'Alpha', monthlyPrice: 300 });
      const b = makePlan({ id: 'b', nameEn: 'Beta', monthlyPrice: 100 });
      plansRepo.find.mockResolvedValue([a, b]);
      subsRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);

      const byName = await service.findAll({ sortBy: 'name', sortDir: 'desc' });
      expect(byName.map((p) => p.id)).toEqual(['b', 'a']);

      plansRepo.find.mockResolvedValue([a, b]);
      subsRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
      const byPrice = await service.findAll({ sortBy: 'monthlyPrice', sortDir: 'asc' });
      expect(byPrice.map((p) => p.id)).toEqual(['b', 'a']);

      plansRepo.find.mockResolvedValue([a, b]);
      subsRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
      const bySubs = await service.findAll({ sortBy: 'subscriberCount', sortDir: 'desc' });
      expect(bySubs.map((p) => p.id)).toEqual(['b', 'a']);
    });
  });

  describe('findOne / findSubscribers (SA-PLAN-2)', () => {
    it('returns plan detail with createdBy relation and subscriberCount', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.count.mockResolvedValue(2);

      const result = await service.findOne('plan-1');

      expect(plansRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        relations: ['createdBy'],
      });
      expect(result.subscriberCount).toBe(2);
    });

    it('returns 404 for an unknown plan id', async () => {
      plansRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('maps subscribers with hotel name, start date and billing cycle', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.find.mockResolvedValue([makeSub()]);

      const result = await service.findSubscribers('plan-1');

      expect(result).toEqual([
        expect.objectContaining({
          hotelId: 'hotel-1',
          hotelName: 'Nile Grand',
          billingCycle: 'monthly',
          status: 'active',
          daysRemaining: null,
        }),
      ]);
    });

    it('includes daysRemaining for running trials (SA-SUB-4 visibility)', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      subsRepo.find.mockResolvedValue([
        makeSub({ status: 'trial', trialEndsAt: in5Days }),
      ]);

      const [row] = await service.findSubscribers('plan-1');
      expect(row.daysRemaining).toBe(5);
    });
  });

  describe('create (SA-PLAN-3)', () => {
    const validDto = {
      nameEn: 'Basic',
      nameAr: 'أساسي',
      monthlyPrice: 50,
      enabledModules: ['transportation'],
    };

    it('creates an active plan and audits plan.created with the actor', async () => {
      plansRepo.findOne.mockResolvedValue(null);

      const created = await service.create(validDto, actor);

      expect(created.status).toBe('active');
      expect(created.currency).toBe('EGP');
      expect(created.createdById).toBe('admin-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'plan.created', actorId: 'admin-1' }),
      );
    });

    it('rejects unknown module keys with 422', async () => {
      await expect(
        service.create(
          { ...validDto, enabledModules: ['transportation', 'spa', 'gym'] },
          actor,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException('Unknown module keys: spa, gym'),
      );
    });

    it('returns 409 on duplicate English name (case-insensitive)', async () => {
      plansRepo.findOne.mockResolvedValueOnce(makePlan());
      await expect(
        service.create({ ...validDto, nameEn: 'standard' }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 409 on duplicate Arabic name', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(null) // nameEn free
        .mockResolvedValueOnce(makePlan()); // nameAr taken
      await expect(service.create(validDto, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('requires trialDurationDays for trial plans', async () => {
      plansRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({ ...validDto, isTrial: true }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 409 when an active trial plan already exists (one at a time)', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(null) // nameEn
        .mockResolvedValueOnce(null) // nameAr
        .mockResolvedValueOnce(makePlan({ isTrial: true })); // existing trial
      await expect(
        service.create(
          { ...validDto, isTrial: true, trialDurationDays: 14 },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update (SA-PLAN-4)', () => {
    it('returns 409 with violation details when a limit drops below usage', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.find.mockResolvedValue([makeSub()]); // hotel has 80 rooms

      await expect(
        service.update('plan-1', { maxRooms: 50 }, actor),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          violations: [
            expect.objectContaining({
              hotelId: 'hotel-1',
              hotelName: 'Nile Grand',
              field: 'maxRooms',
              usage: 80,
              limit: 50,
            }),
          ],
        }),
      });
    });

    it('treats tightening from unlimited (null) as a guarded change', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ maxGuestRequestsPerMonth: null }));
      subsRepo.find.mockResolvedValue([makeSub()]); // 500 requests

      await expect(
        service.update('plan-1', { maxGuestRequestsPerMonth: 400 }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('allows raising or removing limits without touching subscribers', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());

      const updated = await service.update(
        'plan-1',
        { maxRooms: 500, maxStaffUsers: null },
        actor,
      );

      expect(updated.maxRooms).toBe(500);
      expect(updated.maxStaffUsers).toBeNull();
      expect(subsRepo.find).not.toHaveBeenCalled();
    });

    it('audits plan.updated with a before/after diff of changed fields only', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());

      await service.update(
        'plan-1',
        { monthlyPrice: 150, currency: 'EGP' },
        actor,
      );

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'plan.updated',
          metadata: {
            before: { monthlyPrice: 100 },
            after: { monthlyPrice: 150 },
          },
        }),
      );
    });

    it('changing trialDurationDays never touches existing subscriptions (SA-PLAN-3 AC5)', async () => {
      plansRepo.findOne.mockResolvedValue(
        makePlan({ isTrial: true, trialDurationDays: 14 }),
      );

      await service.update('plan-1', { trialDurationDays: 21 }, actor);

      expect(subsRepo.find).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown id', async () => {
      plansRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { monthlyPrice: 1 }, actor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive/restore (SA-PLAN-5)', () => {
    it('returns 409 with the subscriber count when hotels are still subscribed', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.count.mockResolvedValue(4);

      await expect(service.archive('plan-1', actor)).rejects.toMatchObject({
        response: expect.objectContaining({ subscriberCount: 4 }),
      });
    });

    it('archives a plan without subscribers and audits plan.archived', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan());
      subsRepo.count.mockResolvedValue(0);

      const archived = await service.archive('plan-1', actor);

      expect(archived.status).toBe('archived');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'plan.archived', actorId: 'admin-1' }),
      );
    });

    it('rejects archiving an already-archived plan', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ status: 'archived' }));
      await expect(service.archive('plan-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('restores an archived plan and audits plan.restored', async () => {
      plansRepo.findOne.mockResolvedValue(makePlan({ status: 'archived' }));

      const restored = await service.restore('plan-1', actor);

      expect(restored.status).toBe('active');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'plan.restored' }),
      );
    });

    it('blocks restoring a trial plan when another active trial exists', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(makePlan({ status: 'archived', isTrial: true }))
        .mockResolvedValueOnce(makePlan({ id: 'plan-2', isTrial: true }));

      await expect(service.restore('plan-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('exposes no hard-delete method (soft archive only)', () => {
      expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
    });
  });

  describe('getModuleCatalog (SA-PLAN-6)', () => {
    it('returns the full platform module catalog', () => {
      const catalog = service.getModuleCatalog();
      expect(catalog).toBe(MODULE_CATALOG);
      expect(catalog.map((m) => m.key)).toEqual([
        'transportation',
        'housekeeping',
        'fnb',
        'guest_app_branding',
        'analytics',
      ]);
    });
  });
});
