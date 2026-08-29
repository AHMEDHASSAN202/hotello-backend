import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { RenditionService } from '../renditions/rendition.service';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantBrandingService } from './tenant-branding.service';

// Two-rendition pipeline is exercised structurally — sharp itself is mocked.
jest.mock('sharp', () => {
  const instance = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('img')),
  };
  return { __esModule: true, default: jest.fn(() => instance) };
});

describe('TenantBrandingService (18.1)', () => {
  let service: TenantBrandingService;
  let hotelsRepo: { findOne: jest.Mock; save: jest.Mock };
  let auditLogs: { log: jest.Mock };
  let storage: { put: jest.Mock; delete: jest.Mock };
  const actor = { id: 'u1', hotelId: 'h1' } as unknown as TenantUser;

  const hotel = () => ({
    id: 'h1',
    brandAccentColor: null as string | null,
    coverImageThumbKey: null as string | null,
    coverImageDetailKey: null as string | null,
    welcomeMessage: null as Record<string, string> | null,
  });

  beforeEach(async () => {
    hotelsRepo = { findOne: jest.fn(), save: jest.fn(async (h) => h) };
    auditLogs = { log: jest.fn() };
    storage = { put: jest.fn(), delete: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        TenantBrandingService,
        RenditionService,
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: STORAGE_DRIVER, useValue: storage },
      ],
    }).compile();
    service = module.get(TenantBrandingService);
  });

  describe('getBranding (AC1)', () => {
    it('maps storage keys to files/ paths and returns all three knobs', async () => {
      hotelsRepo.findOne.mockResolvedValue({
        ...hotel(),
        brandAccentColor: '#0F6B5C',
        coverImageThumbKey: 'branding/h1/x-thumb.webp',
        coverImageDetailKey: 'branding/h1/x-detail.webp',
        welcomeMessage: { ar: 'أهلاً', en: 'Welcome' },
      });
      const view = await service.getBranding(actor);
      expect(view).toEqual({
        brandAccentColor: '#0F6B5C',
        coverThumbUrl: 'files/branding/h1/x-thumb.webp',
        coverDetailUrl: 'files/branding/h1/x-detail.webp',
        welcomeMessage: { ar: 'أهلاً', en: 'Welcome' },
      });
      expect(hotelsRepo.findOne).toHaveBeenCalledWith({ where: { id: 'h1' } });
    });
  });

  describe('updateBranding — accent (AC1, AC3)', () => {
    it('persists a passing accent and audits branding.updated with a diff', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      const view = await service.updateBranding(actor, { brandAccentColor: '#0F6B5C' });
      expect(view.brandAccentColor).toBe('#0F6B5C');
      expect(hotelsRepo.save).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'branding.updated',
          entityType: 'hotel',
          entityId: 'h1',
          actorId: 'u1',
          metadata: expect.objectContaining({
            hotelId: 'h1',
            diff: { brandAccentColor: { from: null, to: '#0F6B5C' } },
          }),
        }),
      );
    });

    it('blocks a low-contrast accent with a nearest-safe suggestion', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      await expect(
        service.updateBranding(actor, { brandAccentColor: '#FFA500' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'BRANDING_ACCENT_CONTRAST',
          suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        }),
      });
      expect(hotelsRepo.save).not.toHaveBeenCalled();
    });

    it('clears the accent with an empty string (per-knob reset, AC3)', async () => {
      hotelsRepo.findOne.mockResolvedValue({ ...hotel(), brandAccentColor: '#0F6B5C' });
      const view = await service.updateBranding(actor, { brandAccentColor: '' });
      expect(view.brandAccentColor).toBeNull();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            diff: { brandAccentColor: { from: '#0F6B5C', to: null } },
          }),
        }),
      );
    });
  });

  describe('updateBranding — welcome message (AC1)', () => {
    it('stores trimmed translations and requires AR + EN', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      const view = await service.updateBranding(actor, {
        welcomeAr: ' أهلاً بكم في قلب الغردقة ',
        welcomeEn: 'Welcome to the heart of Hurghada',
        welcomeRu: '',
      });
      expect(view.welcomeMessage).toEqual({
        ar: 'أهلاً بكم في قلب الغردقة',
        en: 'Welcome to the heart of Hurghada',
      });
    });

    it('rejects a welcome message missing AR or EN', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      await expect(
        service.updateBranding(actor, { welcomeEn: 'Only English' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BRANDING_WELCOME_REQUIRED' }),
      });
    });

    it('clears the message when every provided field is empty (per-knob reset, AC3)', async () => {
      hotelsRepo.findOne.mockResolvedValue({
        ...hotel(),
        welcomeMessage: { ar: 'أهلاً', en: 'Welcome' },
      });
      const view = await service.updateBranding(actor, {
        welcomeAr: '',
        welcomeEn: '',
        welcomeRu: '',
        welcomeFr: '',
        welcomeIt: '',
        welcomeEs: '',
        welcomeDe: '',
      });
      expect(view.welcomeMessage).toBeNull();
    });
  });

  it('no change → no save, no audit (AC3 diff discipline)', async () => {
    hotelsRepo.findOne.mockResolvedValue({ ...hotel(), brandAccentColor: '#0F6B5C' });
    await service.updateBranding(actor, { brandAccentColor: '#0F6B5C' });
    expect(hotelsRepo.save).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  describe('cover image (AC1 cover, AC3)', () => {
    const file = { buffer: Buffer.from('png'), mimetype: 'image/png', size: 1000 };

    it('stores two wide renditions under branding/{hotelId}/ and audits', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      const view = await service.setCover(actor, file);
      expect(storage.put).toHaveBeenCalledTimes(2);
      const keys = storage.put.mock.calls.map((c) => c[0] as string);
      expect(keys[0]).toMatch(/^branding\/h1\/[0-9a-f-]+-thumb\.webp$/);
      expect(keys[1]).toMatch(/^branding\/h1\/[0-9a-f-]+-detail\.webp$/);
      expect(view.coverThumbUrl).toBe(`files/${keys[0]}`);
      expect(view.coverDetailUrl).toBe(`files/${keys[1]}`);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'branding.updated',
          metadata: expect.objectContaining({ diff: { coverImage: { changed: true } } }),
        }),
      );
    });

    it('replacing deletes the previous renditions quietly', async () => {
      hotelsRepo.findOne.mockResolvedValue({
        ...hotel(),
        coverImageThumbKey: 'branding/h1/old-thumb.webp',
        coverImageDetailKey: 'branding/h1/old-detail.webp',
      });
      await service.setCover(actor, file);
      expect(storage.delete).toHaveBeenCalledWith('branding/h1/old-thumb.webp');
      expect(storage.delete).toHaveBeenCalledWith('branding/h1/old-detail.webp');
    });

    it('a failing old-file delete never fails the mutation', async () => {
      storage.delete.mockRejectedValue(new Error('gone'));
      hotelsRepo.findOne.mockResolvedValue({
        ...hotel(),
        coverImageThumbKey: 'branding/h1/old-thumb.webp',
        coverImageDetailKey: 'branding/h1/old-detail.webp',
      });
      await expect(service.setCover(actor, file)).resolves.toBeDefined();
    });

    it('rejects a missing file and disallowed mime types', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      await expect(service.setCover(actor, undefined)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BRANDING_COVER_REQUIRED' }),
      });
      await expect(
        service.setCover(actor, { ...file, mimetype: 'image/svg+xml' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BRANDING_COVER_INVALID' }),
      });
    });

    it('removeCover clears keys, deletes files, audits removal (AC3 reset)', async () => {
      hotelsRepo.findOne.mockResolvedValue({
        ...hotel(),
        coverImageThumbKey: 'branding/h1/old-thumb.webp',
        coverImageDetailKey: 'branding/h1/old-detail.webp',
      });
      const view = await service.removeCover(actor);
      expect(view.coverThumbUrl).toBeNull();
      expect(view.coverDetailUrl).toBeNull();
      expect(storage.delete).toHaveBeenCalledWith('branding/h1/old-thumb.webp');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ diff: { coverImage: { removed: true } } }),
        }),
      );
    });

    it('removeCover with no cover is a no-op (no save, no audit)', async () => {
      hotelsRepo.findOne.mockResolvedValue(hotel());
      await service.removeCover(actor);
      expect(hotelsRepo.save).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });
});
