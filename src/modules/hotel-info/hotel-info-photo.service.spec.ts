import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RenditionService } from '../renditions/rendition.service';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import { HotelInfoPhotoService } from './hotel-info-photo.service';

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

const makeEntry = (o: Record<string, unknown> = {}) =>
  ({
    id: 'entry-1',
    hotelId: 'hotel-1',
    section: 'facilities',
    names: { ar: 'المسبح', en: 'Pool' },
    descriptions: null,
    structured: {},
    photos: [],
    sortOrder: 0,
    isActive: true,
    ...o,
  }) as unknown as HotelInfoEntry;

const file = (mimetype = 'image/jpeg') => ({
  buffer: Buffer.from('raw'),
  mimetype,
  size: 100,
});

describe('HotelInfoPhotoService (17.1 AC1, spec note 5 reuse)', () => {
  let service: HotelInfoPhotoService;
  let repo: { findOne: jest.Mock; save: jest.Mock };
  let storage: { put: jest.Mock; delete: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(makeEntry()),
      save: jest.fn(async (e) => e),
    };
    storage = { put: jest.fn(), delete: jest.fn() };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HotelInfoPhotoService,
        RenditionService,
        { provide: getRepositoryToken(HotelInfoEntry), useValue: repo },
        { provide: STORAGE_DRIVER, useValue: storage },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(HotelInfoPhotoService);
  });

  it('adds a photo to a facility: two webp renditions under hotel-info/ keys', async () => {
    const view = await service.addPhoto(actor, 'entry-1', file());
    expect(storage.put).toHaveBeenCalledTimes(2);
    const keys = storage.put.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toMatch(/^hotel-info\/hotel-1\/entry-1\/.+-thumb\.webp$/);
    expect(keys[1]).toMatch(/^hotel-info\/hotel-1\/entry-1\/.+-detail\.webp$/);
    expect(view.photos).toHaveLength(1);
    expect(view.photos[0].thumbUrl).toBe(`files/${keys[0]}`);
  });

  it('enforces the per-section cap: facilities max 1 → HOTEL_INFO_PHOTOS_FULL', async () => {
    repo.findOne.mockResolvedValue(
      makeEntry({ photos: [{ id: 'p1', thumb: 't', detail: 'd' }] }),
    );
    await expect(service.addPhoto(actor, 'entry-1', file())).rejects.toMatchObject(
      { response: { code: 'HOTEL_INFO_PHOTOS_FULL', max: 1, count: 1 } },
    );
  });

  it('about gallery accepts up to 8, then 409s', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      thumb: `t${i}`,
      detail: `d${i}`,
    }));
    repo.findOne.mockResolvedValue(
      makeEntry({ section: 'about', photos: seven }),
    );
    const view = await service.addPhoto(actor, 'entry-1', file());
    expect(view.photos).toHaveLength(8);

    repo.findOne.mockResolvedValue(
      makeEntry({
        section: 'about',
        photos: [...seven, { id: 'p8', thumb: 't8', detail: 'd8' }],
      }),
    );
    await expect(service.addPhoto(actor, 'entry-1', file())).rejects.toMatchObject(
      { response: { code: 'HOTEL_INFO_PHOTOS_FULL', max: 8, count: 8 } },
    );
  });

  it('sections without photos always 409 (house_rules)', async () => {
    repo.findOne.mockResolvedValue(makeEntry({ section: 'house_rules' }));
    await expect(service.addPhoto(actor, 'entry-1', file())).rejects.toMatchObject(
      { response: { code: 'HOTEL_INFO_PHOTOS_FULL', max: 0 } },
    );
  });

  it('rejects non-image mime types with HOTEL_INFO_PHOTO_INVALID', async () => {
    await expect(
      service.addPhoto(actor, 'entry-1', file('image/svg+xml')),
    ).rejects.toMatchObject({ response: { code: 'HOTEL_INFO_PHOTO_INVALID' } });
    await expect(service.addPhoto(actor, 'entry-1', undefined)).rejects.toMatchObject(
      { response: { code: 'HOTEL_INFO_PHOTO_INVALID' } },
    );
  });

  it('cross-tenant / unknown entry → 404', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.addPhoto(actor, 'foreign', file())).rejects.toMatchObject(
      { response: { code: 'HOTEL_INFO_ENTRY_NOT_FOUND' } },
    );
    expect(repo.findOne.mock.calls[0][0].where).toMatchObject({
      id: 'foreign',
      hotelId: 'hotel-1',
    });
  });

  it('removePhoto deletes both renditions best-effort and audits keys only', async () => {
    repo.findOne.mockResolvedValue(
      makeEntry({ photos: [{ id: 'p1', thumb: 'kt', detail: 'kd' }] }),
    );
    storage.delete.mockRejectedValueOnce(new Error('gone'));
    const view = await service.removePhoto(actor, 'entry-1', 'p1');
    expect(view.photos).toHaveLength(0);
    expect(storage.delete).toHaveBeenCalledWith('kt');
    expect(storage.delete).toHaveBeenCalledWith('kd');
    const call = auditLogs.log.mock.calls[0][0];
    expect(call.action).toBe('hotel_info.updated');
    expect(call.metadata.diff).toEqual({
      photos: { removed: 'kt' },
    });
  });

  it('removePhoto with an unknown photo id → 404', async () => {
    repo.findOne.mockResolvedValue(
      makeEntry({ photos: [{ id: 'p1', thumb: 'kt', detail: 'kd' }] }),
    );
    await expect(
      service.removePhoto(actor, 'entry-1', 'nope'),
    ).rejects.toMatchObject({
      response: { code: 'HOTEL_INFO_PHOTO_NOT_FOUND' },
    });
  });
});
