import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { STORAGE_DRIVER } from '../storage/storage.interface';
import { RenditionPreset } from './rendition.interface';
import { RenditionService } from './rendition.service';

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

const FNB_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

const HOTEL_INFO_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

const BRANDING_PRESET: RenditionPreset = {
  thumb: { width: 640, height: 360, fit: 'cover', quality: 82 },
  detail: { width: 1440, height: 810, fit: 'cover', quality: 82 },
};

const EVENTS_PRESET: RenditionPreset = {
  thumb: { width: 480, height: 360, fit: 'cover', quality: 80 },
  detail: { width: 1200, height: 1200, fit: 'inside', quality: 82, withoutEnlargement: true },
};

describe('RenditionService (Story 21.1 AC1)', () => {
  let service: RenditionService;
  let storage: { put: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    storage = { put: jest.fn(), delete: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [RenditionService, { provide: STORAGE_DRIVER, useValue: storage }],
    }).compile();
    service = moduleRef.get(RenditionService);
  });

  describe('render', () => {
    it('renders every preset entry and returns a buffer per name', async () => {
      const out = await service.render(Buffer.from('img'), FNB_PRESET);
      expect(Object.keys(out)).toEqual(['thumb', 'detail']);
      expect(out.thumb).toBeInstanceOf(Buffer);
      expect(out.detail).toBeInstanceOf(Buffer);
    });
  });

  describe('store', () => {
    it('produces fnb key shape: fnb/{hotelId}/{ownerId}/{uuid}-{name}.webp', async () => {
      const keys = await service.store('hotel-1', 'fnb', ['item-1'], FNB_PRESET, Buffer.from('img'));
      expect(keys.thumb).toMatch(/^fnb\/hotel-1\/item-1\/[0-9a-f-]+-thumb\.webp$/);
      expect(keys.detail).toMatch(/^fnb\/hotel-1\/item-1\/[0-9a-f-]+-detail\.webp$/);
      // Same uuid segment for both renditions of one store() call.
      const [, , , thumbUuid] = keys.thumb.split('/');
      const [, , , detailUuid] = keys.detail.split('/');
      expect(thumbUuid.replace('-thumb.webp', '')).toBe(detailUuid.replace('-detail.webp', ''));
      expect(storage.put).toHaveBeenCalledTimes(2);
      expect(storage.put).toHaveBeenCalledWith(keys.thumb, expect.any(Buffer), 'image/webp');
      expect(storage.put).toHaveBeenCalledWith(keys.detail, expect.any(Buffer), 'image/webp');
    });

    it('produces hotel-info key shape: hotel-info/{hotelId}/{entryId}/{uuid}-{name}.webp', async () => {
      const keys = await service.store(
        'hotel-1',
        'hotel-info',
        ['entry-1'],
        HOTEL_INFO_PRESET,
        Buffer.from('img'),
      );
      expect(keys.thumb).toMatch(/^hotel-info\/hotel-1\/entry-1\/[0-9a-f-]+-thumb\.webp$/);
      expect(keys.detail).toMatch(/^hotel-info\/hotel-1\/entry-1\/[0-9a-f-]+-detail\.webp$/);
    });

    it('produces the zero-segment branding key shape: branding/{hotelId}/{uuid}-thumb.webp', async () => {
      const keys = await service.store('hotel-1', 'branding', [], BRANDING_PRESET, Buffer.from('img'));
      expect(keys.thumb).toMatch(/^branding\/hotel-1\/[0-9a-f-]+-thumb\.webp$/);
      expect(keys.detail).toMatch(/^branding\/hotel-1\/[0-9a-f-]+-detail\.webp$/);
    });

    it('produces the events key shape: events/{hotelId}/{eventId}/{uuid}-{name}.webp', async () => {
      const keys = await service.store(
        'hotel-1',
        'events',
        ['event-1'],
        EVENTS_PRESET,
        Buffer.from('img'),
      );
      expect(keys.thumb).toMatch(/^events\/hotel-1\/event-1\/[0-9a-f-]+-thumb\.webp$/);
      expect(keys.detail).toMatch(/^events\/hotel-1\/event-1\/[0-9a-f-]+-detail\.webp$/);
    });
  });

  describe('deleteQuietly', () => {
    it('deletes every non-null key', async () => {
      await service.deleteQuietly(['a', null, 'b', undefined]);
      expect(storage.delete).toHaveBeenCalledTimes(2);
      expect(storage.delete).toHaveBeenCalledWith('a');
      expect(storage.delete).toHaveBeenCalledWith('b');
    });

    it('swallows a storage-driver throw and logs a warning without re-throwing', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      storage.delete.mockRejectedValueOnce(new Error('gone'));
      await expect(service.deleteQuietly(['a', 'b'])).resolves.toBeUndefined();
      expect(storage.delete).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('never throws even if every delete fails', async () => {
      storage.delete.mockRejectedValue(new Error('gone'));
      await expect(service.deleteQuietly(['a', 'b', 'c'])).resolves.toBeUndefined();
      expect(storage.delete).toHaveBeenCalledTimes(3);
    });
  });
});
