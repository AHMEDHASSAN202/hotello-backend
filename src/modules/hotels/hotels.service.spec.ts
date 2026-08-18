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
import { Role } from '../roles/role.entity';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { Subscription } from '../subscriptions/subscription.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel } from './hotel.entity';
import { HotelsService } from './hotels.service';
import { TenantUrlsService } from './tenant-urls.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('HotelsService', () => {
  let service: HotelsService;
  let hotelsRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let subsRepo: { findOne: jest.Mock };
  let tenantUsersRepo: { findOne: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let events: { emitAsync: jest.Mock };
  let qb: Record<string, jest.Mock>;

  const superAdmin = {
    id: 'admin-1',
    role: { permissions: ['*'] } as Role,
  } as Admin;
  const regularAdmin = {
    id: 'admin-2',
    role: { permissions: ['hotels.update'] } as Role,
  } as Admin;

  const makeHotel = (overrides: Partial<Hotel> = {}): Hotel =>
    ({
      id: 'hotel-1',
      nameEn: 'Nile Grand',
      nameAr: 'نايل جراند',
      slug: 'nile-grand',
      status: 'active',
      logoPath: null,
      starRating: 4,
      contactEmail: 'manager@nilegrand.example',
      contactPhone: '+20 100 000 0000',
      address: null,
      city: 'Cairo',
      country: 'Egypt',
      timezone: 'Africa/Cairo',
      defaultLanguage: 'ar',
      currency: 'EGP',
      declaredRoomsCount: 80,
      roomsCount: 80,
      staffUsersCount: 12,
      monthlyGuestRequests: 500,
      suspensionReason: null,
      suspensionNote: null,
      suspendedAt: null,
      suspendedById: null,
      suspendedBy: null,
      onboardedById: null,
      onboardedBy: null,
      createdAt: new Date('2026-07-01'),
      updatedAt: new Date('2026-07-01'),
      ...overrides,
    }) as Hotel;

  beforeEach(async () => {
    qb = {} as Record<string, jest.Mock>;
    for (const method of [
      'leftJoinAndMapOne',
      'leftJoinAndSelect',
      'andWhere',
      'orderBy',
      'skip',
      'take',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);

    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue(makeHotel()),
      save: jest.fn(async (h) => h),
      createQueryBuilder: jest.fn(() => qb),
    };
    subsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    tenantUsersRepo = { findOne: jest.fn().mockResolvedValue(null) };
    storage = {
      put: jest.fn(),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    auditLogs = { log: jest.fn() };
    events = { emitAsync: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HotelsService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: getRepositoryToken(Subscription), useValue: subsRepo },
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsersRepo },
        { provide: STORAGE_DRIVER, useValue: storage },
        {
          provide: TenantUrlsService,
          useValue: {
            buildUrls: (slug: string) => ({
              tenantDashboard: `https://${slug}.gxp.example`,
              guestApp: `https://guest.gxp.example/${slug}`,
            }),
          },
        },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = moduleRef.get(HotelsService);
  });

  describe('findAll (SA-HTL-1)', () => {
    it('paginates with a default page size of 20', async () => {
      await service.findAll({});
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('searches name (EN/AR) and slug with one parameter', async () => {
      await service.findAll({ search: 'nile' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('hotel.slug ILIKE :search'),
        { search: '%nile%' },
      );
    });

    it('applies status, subscription status, plan and city filters', async () => {
      await service.findAll({
        status: 'suspended',
        subscriptionStatus: 'trial',
        planId: 'plan-1',
        city: 'cairo',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('hotel.status = :status', {
        status: 'suspended',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('sub.status = :subStatus', {
        subStatus: 'trial',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('sub.planId = :planId', {
        planId: 'plan-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('hotel.city ILIKE :city', {
        city: '%cairo%',
      });
    });

    it('sorts by plan name with NULLS LAST for un-subscribed hotels', async () => {
      await service.findAll({ sortBy: 'plan', sortDir: 'asc' });
      expect(qb.orderBy).toHaveBeenCalledWith('plan.nameEn', 'ASC', 'NULLS LAST');
    });

    it('maps current plan, subscription status and trial days remaining', async () => {
      const trialEndsAt = new Date(Date.now() + 5 * DAY_MS);
      const hotel = makeHotel() as Hotel & {
        currentSubscription?: Partial<Subscription>;
      };
      hotel.currentSubscription = {
        status: 'trial',
        trialEndsAt,
        plan: {
          id: 'plan-2',
          nameEn: 'Free Trial',
          nameAr: 'التجربة المجانية',
          isTrial: true,
        },
      } as Subscription;
      qb.getManyAndCount.mockResolvedValue([[hotel], 1]);

      const result = await service.findAll({});

      expect(result.total).toBe(1);
      expect(result.data[0].plan).toEqual(
        expect.objectContaining({ nameEn: 'Free Trial', isTrial: true }),
      );
      expect(result.data[0].subscription).toEqual(
        expect.objectContaining({ status: 'trial', daysRemaining: 5 }),
      );
    });
  });

  describe('findOne (SA-HTL-2 / SA-HTL-7)', () => {
    it('returns 404 for an unknown hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('embeds the owner account and computes tenant URLs from the slug', async () => {
      tenantUsersRepo.findOne.mockResolvedValue({
        id: 'owner-1',
        name: 'Owner',
        email: 'owner@nilegrand.example',
        status: 'pending',
        lastLoginAt: null,
      } as TenantUser);

      const detail = await service.findOne('hotel-1');

      expect(detail.owner).toEqual(
        expect.objectContaining({ email: 'owner@nilegrand.example' }),
      );
      expect(detail.urls).toEqual({
        tenantDashboard: 'https://nile-grand.gxp.example',
        guestApp: 'https://guest.gxp.example/nile-grand',
      });
    });

    it('derives logoUrl from the stored key', async () => {
      hotelsRepo.findOne.mockResolvedValue(
        makeHotel({ logoPath: 'hotels/hotel-1/logo-1.png' }),
      );
      const detail = await service.findOne('hotel-1');
      expect(detail.logoUrl).toBe('/files/hotels/hotel-1/logo-1.png');
    });
  });

  describe('checkSlug (SA-HTL-3 AC3)', () => {
    it('flags malformed slugs as invalid', async () => {
      expect(await service.checkSlug('-bad-')).toEqual({
        available: false,
        reason: 'invalid',
      });
      expect(await service.checkSlug('ab')).toEqual({
        available: false,
        reason: 'invalid',
      });
      expect(await service.checkSlug('Bad-Case')).toEqual({
        available: false,
        reason: 'invalid',
      });
    });

    it('rejects reserved words', async () => {
      expect(await service.checkSlug('admin')).toEqual({
        available: false,
        reason: 'reserved',
      });
    });

    it('reports taken vs available', async () => {
      expect(await service.checkSlug('nile-grand')).toEqual({
        available: false,
        reason: 'taken',
      });
      hotelsRepo.findOne.mockResolvedValue(null);
      expect(await service.checkSlug('new-hotel')).toEqual({ available: true });
    });
  });

  describe('update (SA-HTL-4)', () => {
    it('audits hotel.updated with a diff of only the changed fields', async () => {
      await service.update(
        'hotel-1',
        { city: 'Giza', nameEn: 'Nile Grand' }, // nameEn unchanged
        regularAdmin,
      );

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.updated',
          metadata: {
            diff: { city: { from: 'Cairo', to: 'Giza' } },
          },
        }),
      );
    });

    it('does not audit when nothing changed', async () => {
      await service.update('hotel-1', { city: 'Cairo' }, regularAdmin);
      expect(auditLogs.log).not.toHaveBeenCalled();
    });

    it('stores address coordinates and audits them as ordinary profile fields', async () => {
      await service.update(
        'hotel-1',
        { latitude: 30.0444, longitude: 31.2357 },
        regularAdmin,
      );

      expect(hotelsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 30.0444, longitude: 31.2357 }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.updated',
          metadata: {
            diff: {
              latitude: { from: undefined, to: 30.0444 },
              longitude: { from: undefined, to: 31.2357 },
            },
          },
        }),
      );
    });
  });

  describe('update (11.6)', () => {
    it('AC2 — roomsCount is no longer updatable and no plan-limit assert runs on edit (5.4 AC3 removed)', async () => {
      const dto = { roomsCount: 999 } as unknown as UpdateHotelDto;

      await service.update('hotel-1', dto, regularAdmin);

      expect(subsRepo.findOne).not.toHaveBeenCalled();
      const saved = hotelsRepo.save.mock.calls[0][0] as Hotel;
      expect(saved.roomsCount).toBe(80); // unchanged from makeHotel()
    });

    it('AC2 — a "force" flag no longer has any effect (Story 5.4 force path removed)', async () => {
      const dto = { roomsCount: 999, force: true } as unknown as UpdateHotelDto;

      await service.update('hotel-1', dto, regularAdmin);

      const saved = hotelsRepo.save.mock.calls[0][0] as Hotel;
      expect(saved.roomsCount).toBe(80);
      expect(auditLogs.log).not.toHaveBeenCalled(); // nothing whitelisted changed
    });

    it('AC2 — toDetail exposes declaredRoomsCount alongside derived roomsCount', async () => {
      hotelsRepo.findOne.mockResolvedValue(
        makeHotel({ declaredRoomsCount: 80, roomsCount: 65 }),
      );

      const detail = await service.findOne('hotel-1');

      expect(detail.roomsCount).toBe(65);
      expect(detail.declaredRoomsCount).toBe(80);
    });
  });

  describe('slug change (SA-HTL-3 AC3)', () => {
    it('rejects a slug change from a non-wildcard admin', async () => {
      await expect(
        service.update('hotel-1', { slug: 'new-slug' }, regularAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a reserved replacement slug even for Super Admin', async () => {
      await expect(
        service.update('hotel-1', { slug: 'admin' }, superAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets Super Admin change the slug and audits old/new values', async () => {
      // First findOne loads the hotel; the uniqueness check must miss.
      hotelsRepo.findOne
        .mockResolvedValueOnce(makeHotel())
        .mockResolvedValueOnce(null)
        .mockResolvedValue(makeHotel({ slug: 'grand-nile' }));

      await service.update('hotel-1', { slug: 'grand-nile' }, superAdmin);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.slug_changed',
          metadata: { old: 'nile-grand', new: 'grand-nile' },
        }),
      );
    });
  });

  describe('suspend/reactivate (SA-HTL-5)', () => {
    it('stores reason, note, timestamp and actor, and audits with the reason', async () => {
      await service.suspend(
        'hotel-1',
        { reason: 'non_payment', note: 'Invoice 90 days overdue' },
        superAdmin,
      );

      const saved = hotelsRepo.save.mock.calls[0][0] as Hotel;
      expect(saved.status).toBe('suspended');
      expect(saved.suspensionReason).toBe('non_payment');
      expect(saved.suspensionNote).toBe('Invoice 90 days overdue');
      expect(saved.suspendedAt).toBeInstanceOf(Date);
      expect(saved.suspendedById).toBe('admin-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'hotel.suspended',
          metadata: expect.objectContaining({ reason: 'non_payment' }),
        }),
      );
    });

    it('emits hotel.suspended with the reason category only — never the note (6.6 AC1)', async () => {
      await service.suspend(
        'hotel-1',
        { reason: 'non_payment', note: 'Invoice 90 days overdue' },
        superAdmin,
      );

      expect(events.emitAsync).toHaveBeenCalledWith(
        'hotel.suspended',
        expect.objectContaining({
          hotelId: 'hotel-1',
          reason: 'non_payment',
          suspendedAt: expect.any(Date),
        }),
      );
      const payload = events.emitAsync.mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('note');
      expect(JSON.stringify(payload)).not.toContain('Invoice 90 days overdue');
    });

    it('rejects suspending an already-suspended hotel', async () => {
      hotelsRepo.findOne.mockResolvedValue(makeHotel({ status: 'suspended' }));
      await expect(
        service.suspend('hotel-1', { reason: 'other' }, superAdmin),
      ).rejects.toThrow(ConflictException);
    });

    it('never touches the subscription (AC4)', async () => {
      await service.suspend('hotel-1', { reason: 'policy_violation' }, superAdmin);
      expect(subsRepo.findOne).not.toHaveBeenCalled();
    });

    it('reactivation clears all suspension fields and audits', async () => {
      hotelsRepo.findOne.mockResolvedValue(
        makeHotel({
          status: 'suspended',
          suspensionReason: 'non_payment',
          suspensionNote: 'note',
          suspendedAt: new Date(),
          suspendedById: 'admin-1',
        }),
      );

      await service.reactivate('hotel-1', superAdmin);

      const saved = hotelsRepo.save.mock.calls[0][0] as Hotel;
      expect(saved.status).toBe('active');
      expect(saved.suspensionReason).toBeNull();
      expect(saved.suspensionNote).toBeNull();
      expect(saved.suspendedAt).toBeNull();
      expect(saved.suspendedById).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'hotel.reactivated' }),
      );
      // 6.6 AC2 — reactivation notice event with its occurrence timestamp.
      expect(events.emitAsync).toHaveBeenCalledWith(
        'hotel.reactivated',
        expect.objectContaining({
          hotelId: 'hotel-1',
          occurredAt: expect.any(Date),
        }),
      );
    });

    it('rejects reactivating a hotel that is not suspended', async () => {
      await expect(service.reactivate('hotel-1', superAdmin)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('uploadLogo (SA-HTL-3 AC2)', () => {
    const makeFile = (
      overrides: Partial<Express.Multer.File> = {},
    ): Express.Multer.File =>
      ({
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('img'),
        ...overrides,
      }) as Express.Multer.File;

    it('rejects unsupported mime types', async () => {
      await expect(
        service.uploadLogo('hotel-1', makeFile({ mimetype: 'image/gif' }), superAdmin),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects files over 2MB', async () => {
      await expect(
        service.uploadLogo(
          'hotel-1',
          makeFile({ size: 3 * 1024 * 1024 }),
          superAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores a key (never a URL) and deletes the previous object', async () => {
      hotelsRepo.findOne.mockResolvedValue(
        makeHotel({ logoPath: 'hotels/hotel-1/logo-old.png' }),
      );

      const result = await service.uploadLogo('hotel-1', makeFile(), superAdmin);

      expect(result.logoPath).toMatch(/^hotels\/hotel-1\/logo-\d+\.png$/);
      expect(result.logoUrl).toBe(`/files/${result.logoPath}`);
      expect(storage.put).toHaveBeenCalledWith(
        result.logoPath,
        expect.any(Buffer),
        'image/png',
      );
      expect(storage.delete).toHaveBeenCalledWith('hotels/hotel-1/logo-old.png');
    });
  });
});
