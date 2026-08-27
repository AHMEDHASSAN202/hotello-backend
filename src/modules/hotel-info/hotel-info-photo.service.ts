import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import {
  HOTEL_INFO_MAX_PHOTOS,
  HotelInfoPhoto,
} from './hotel-info.constants';
import { InfoEntryManageView, toManageView } from './hotel-info-view';

/** No SVG — photos only; served bytes are always re-encoded WebP. */
const PHOTO_MIME_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
};

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Epic 17 — entry photos (facility card photo, About gallery). Same pipeline
 * as F&B (spec note 5): two WebP renditions, immutable uuid keys under
 * `hotel-info/` (files controller serves those with a year-long immutable
 * cache), storage-driver backed, per-section count caps. Derived assets are
 * deleted on removal — they're not business records.
 */
@Injectable()
export class HotelInfoPhotoService {
  private readonly logger = new Logger(HotelInfoPhotoService.name);

  constructor(
    @InjectRepository(HotelInfoEntry)
    private readonly repo: Repository<HotelInfoEntry>,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async addPhoto(
    user: TenantUser,
    entryId: string,
    file: UploadedPhoto | undefined,
  ): Promise<InfoEntryManageView> {
    if (!file || !PHOTO_MIME_TYPES[file.mimetype]) {
      throw new BadRequestException({
        code: 'HOTEL_INFO_PHOTO_INVALID',
        message: 'Upload a PNG, JPEG or WebP image (max 5 MB)',
      });
    }
    const entry = await this.findEntry(user.hotelId, entryId);
    const max = HOTEL_INFO_MAX_PHOTOS[entry.section];
    if (entry.photos.length >= max) {
      throw new ConflictException({
        code: 'HOTEL_INFO_PHOTOS_FULL',
        message: `This section allows at most ${max} photo(s)`,
        max,
        count: entry.photos.length,
      });
    }

    const base = `hotel-info/${user.hotelId}/${entry.id}/${randomUUID()}`;
    const photo: HotelInfoPhoto = {
      id: randomUUID(),
      thumb: `${base}-thumb.webp`,
      detail: `${base}-detail.webp`,
    };
    const [thumb, detail] = await Promise.all([
      sharp(file.buffer)
        .rotate()
        .resize(480, 360, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer(),
      sharp(file.buffer)
        .rotate()
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
    ]).catch(() => {
      throw new BadRequestException({
        code: 'HOTEL_INFO_PHOTO_INVALID',
        message: 'The uploaded file could not be read as an image',
      });
    });

    await this.storage.put(photo.thumb, thumb, 'image/webp');
    await this.storage.put(photo.detail, detail, 'image/webp');

    entry.photos = [...entry.photos, photo];
    await this.repo.save(entry);

    await this.audit(user, entry, { photos: { added: photo.thumb } });
    return toManageView(entry);
  }

  async removePhoto(
    user: TenantUser,
    entryId: string,
    photoId: string,
  ): Promise<InfoEntryManageView> {
    const entry = await this.findEntry(user.hotelId, entryId);
    const photo = entry.photos.find((p) => p.id === photoId);
    if (!photo) {
      throw new NotFoundException({
        code: 'HOTEL_INFO_PHOTO_NOT_FOUND',
        message: 'Photo not found',
      });
    }
    entry.photos = entry.photos.filter((p) => p.id !== photoId);
    await this.repo.save(entry);
    await this.deleteQuietly(photo);
    await this.audit(user, entry, { photos: { removed: photo.thumb } });
    return toManageView(entry);
  }

  private async findEntry(
    hotelId: string,
    id: string,
  ): Promise<HotelInfoEntry> {
    const entry = await this.repo.findOne({ where: { id, hotelId } });
    if (!entry) {
      throw new NotFoundException({
        code: 'HOTEL_INFO_ENTRY_NOT_FOUND',
        message: 'Entry not found',
      });
    }
    return entry;
  }

  /** Best-effort cleanup — a missing object never fails the mutation. */
  private async deleteQuietly(photo: HotelInfoPhoto): Promise<void> {
    for (const key of [photo.thumb, photo.detail]) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`Failed to delete photo object ${key}: ${err}`);
      }
    }
  }

  private async audit(
    user: TenantUser,
    entry: HotelInfoEntry,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action: 'hotel_info.updated',
      entityType: 'hotel_info_entry',
      entityId: entry.id,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}
