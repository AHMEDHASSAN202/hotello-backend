import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbItem } from './fnb-item.entity';
import { FnbPhotoService } from './fnb-photo.service';
import { TenantFnbMenusService } from './tenant-fnb-menus.service';

// Two-rendition pipeline is exercised structurally — sharp itself is mocked.
jest.mock('sharp', () => {
  const pipeline = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-bytes')),
  };
  return { __esModule: true, default: jest.fn(() => pipeline), pipeline };
});

const actor = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

const makeItem = (o: Record<string, unknown> = {}) =>
  ({
    id: 'item-1',
    hotelId: 'hotel-1',
    names: { ar: 'سلطة', en: 'Salad' },
    photoKeys: null,
    ...o,
  }) as unknown as FnbItem;

describe('FnbPhotoService (16.2 AC2, spec note 6)', () => {
  let service: FnbPhotoService;
  let itemsRepo: { save: jest.Mock };
  let storage: { put: jest.Mock; delete: jest.Mock };
  let menus: { findItem: jest.Mock; toItemView: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    itemsRepo = { save: jest.fn(async (i) => i) };
    storage = { put: jest.fn(), delete: jest.fn() };
    menus = {
      findItem: jest.fn().mockResolvedValue(makeItem()),
      toItemView: jest.fn((i) => ({ id: i.id })),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FnbPhotoService,
        { provide: getRepositoryToken(FnbItem), useValue: itemsRepo },
        { provide: STORAGE_DRIVER, useValue: storage },
        { provide: TenantFnbMenusService, useValue: menus },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(FnbPhotoService);
  });

  const file = (mimetype = 'image/jpeg') => ({
    buffer: Buffer.from('img'),
    mimetype,
    size: 1000,
  });

  it('rejects non-image mime types with FNB_PHOTO_INVALID', async () => {
    await expect(
      service.setPhoto(actor, 'item-1', file('image/svg+xml')),
    ).rejects.toMatchObject({ response: { code: 'FNB_PHOTO_INVALID' } });
    await expect(service.setPhoto(actor, 'item-1', undefined)).rejects.toMatchObject(
      { response: { code: 'FNB_PHOTO_INVALID' } },
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores thumb + detail WebP renditions under immutable fnb/ keys', async () => {
    await service.setPhoto(actor, 'item-1', file());
    expect(storage.put).toHaveBeenCalledTimes(2);
    const keys = storage.put.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toMatch(/^fnb\/hotel-1\/item-1\/[0-9a-f-]+-thumb\.webp$/);
    expect(keys[1]).toMatch(/^fnb\/hotel-1\/item-1\/[0-9a-f-]+-detail\.webp$/);
    expect(storage.put.mock.calls.every((c) => c[2] === 'image/webp')).toBe(true);
    expect(itemsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        photoKeys: { thumb: keys[0], detail: keys[1] },
      }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fnb_item.photo_updated' }),
    );
  });

  it('replacing a photo deletes the old derived objects', async () => {
    menus.findItem.mockResolvedValue(
      makeItem({ photoKeys: { thumb: 'fnb/h/i/old-thumb.webp', detail: 'fnb/h/i/old-detail.webp' } }),
    );
    await service.setPhoto(actor, 'item-1', file());
    expect(storage.delete).toHaveBeenCalledWith('fnb/h/i/old-thumb.webp');
    expect(storage.delete).toHaveBeenCalledWith('fnb/h/i/old-detail.webp');
  });

  it('removePhoto clears keys, deletes objects, audits; no-op without a photo', async () => {
    menus.findItem.mockResolvedValue(
      makeItem({ photoKeys: { thumb: 't', detail: 'd' } }),
    );
    await service.removePhoto(actor, 'item-1');
    expect(itemsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ photoKeys: null }),
    );
    expect(storage.delete).toHaveBeenCalledTimes(2);

    jest.clearAllMocks();
    menus.findItem.mockResolvedValue(makeItem());
    menus.toItemView.mockImplementation((i) => ({ id: i.id }));
    await service.removePhoto(actor, 'item-1');
    expect(itemsRepo.save).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
