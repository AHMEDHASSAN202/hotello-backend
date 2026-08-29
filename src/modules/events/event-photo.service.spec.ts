import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RenditionService } from '../renditions/rendition.service';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { Event } from './event.entity';
import { EventPhotoService } from './event-photo.service';
import { TenantEventsService } from './tenant-events.service';

// Two-rendition pipeline is exercised structurally — sharp itself is mocked
// (the FnbPhotoService/HotelInfoPhotoService precedent).
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

const makeEvent = (o: Record<string, unknown> = {}) =>
  ({
    id: 'event-1',
    hotelId: 'hotel-1',
    titles: { ar: 'حفلة', en: 'Party' },
    photoKeys: null,
    ...o,
  }) as unknown as Event;

describe('EventPhotoService (Story 21.2 photo endpoints)', () => {
  let service: EventPhotoService;
  let eventsRepo: { save: jest.Mock };
  let storage: { put: jest.Mock; delete: jest.Mock };
  let events: { findEvent: jest.Mock; toManageView: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    eventsRepo = { save: jest.fn(async (e) => e) };
    storage = { put: jest.fn(), delete: jest.fn() };
    events = {
      findEvent: jest.fn().mockResolvedValue(makeEvent()),
      toManageView: jest.fn((e) => ({ id: e.id })),
    };
    auditLogs = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventPhotoService,
        RenditionService,
        { provide: getRepositoryToken(Event), useValue: eventsRepo },
        { provide: STORAGE_DRIVER, useValue: storage },
        { provide: TenantEventsService, useValue: events },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(EventPhotoService);
  });

  const file = (mimetype = 'image/jpeg') => ({
    buffer: Buffer.from('img'),
    mimetype,
    size: 1000,
  });

  it('rejects non-image mime types and a missing file with EVENT_PHOTO_INVALID', async () => {
    await expect(
      service.setPhoto(actor, 'event-1', file('image/svg+xml')),
    ).rejects.toMatchObject({ response: { code: 'EVENT_PHOTO_INVALID' } });
    await expect(service.setPhoto(actor, 'event-1', undefined)).rejects.toMatchObject({
      response: { code: 'EVENT_PHOTO_INVALID' },
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores thumb + detail WebP renditions under immutable events/ keys and audits', async () => {
    await service.setPhoto(actor, 'event-1', file());
    expect(storage.put).toHaveBeenCalledTimes(2);
    const keys = storage.put.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toMatch(/^events\/hotel-1\/event-1\/[0-9a-f-]+-thumb\.webp$/);
    expect(keys[1]).toMatch(/^events\/hotel-1\/event-1\/[0-9a-f-]+-detail\.webp$/);
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ photoKeys: { thumb: keys[0], detail: keys[1] } }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.photo_updated' }),
    );
  });

  it('replacing a photo deletes the old derived objects', async () => {
    events.findEvent.mockResolvedValue(
      makeEvent({ photoKeys: { thumb: 'events/h/e/old-thumb.webp', detail: 'events/h/e/old-detail.webp' } }),
    );
    await service.setPhoto(actor, 'event-1', file());
    expect(storage.delete).toHaveBeenCalledWith('events/h/e/old-thumb.webp');
    expect(storage.delete).toHaveBeenCalledWith('events/h/e/old-detail.webp');
  });

  it('removePhoto clears keys, deletes objects, audits; no-op without a photo', async () => {
    events.findEvent.mockResolvedValue(
      makeEvent({ photoKeys: { thumb: 't', detail: 'd' } }),
    );
    await service.removePhoto(actor, 'event-1');
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ photoKeys: null }),
    );
    expect(storage.delete).toHaveBeenCalledTimes(2);

    jest.clearAllMocks();
    events.findEvent.mockResolvedValue(makeEvent());
    events.toManageView.mockImplementation((e) => ({ id: e.id }));
    await service.removePhoto(actor, 'event-1');
    expect(eventsRepo.save).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
