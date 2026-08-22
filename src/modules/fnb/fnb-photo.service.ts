import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { FnbItem } from './fnb-item.entity';
import { FnbPhotoKeys } from './fnb.constants';
import { TenantFnbMenusService, FnbItemManageView } from './tenant-fnb-menus.service';

export const FNB_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** No SVG — photos only; served bytes are always re-encoded WebP. */
export const FNB_PHOTO_MIME_TYPES: Record<string, true> = {
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
 * Epic 16, spec note 6 — item photos: server-side resize to two renditions
 * (list thumb / detail), immutable uuid keys under `fnb/` (files controller
 * serves those with a year-long immutable cache), storage-driver backed.
 * Replacing/removing deletes the old derived objects — they're derived
 * assets, not business records.
 */
@Injectable()
export class FnbPhotoService {
  private readonly logger = new Logger(FnbPhotoService.name);

  constructor(
    @InjectRepository(FnbItem)
    private readonly itemsRepo: Repository<FnbItem>,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly menus: TenantFnbMenusService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async setPhoto(
    user: TenantUser,
    itemId: string,
    file: UploadedPhoto | undefined,
  ): Promise<FnbItemManageView> {
    if (!file || !FNB_PHOTO_MIME_TYPES[file.mimetype]) {
      throw new BadRequestException({
        code: 'FNB_PHOTO_INVALID',
        message: 'Upload a PNG, JPEG or WebP image (max 5 MB)',
      });
    }
    const item = await this.menus.findItem(user.hotelId, itemId);

    const base = `fnb/${user.hotelId}/${item.id}/${randomUUID()}`;
    const keys: FnbPhotoKeys = {
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
        code: 'FNB_PHOTO_INVALID',
        message: 'The uploaded file could not be read as an image',
      });
    });

    await this.storage.put(keys.thumb, thumb, 'image/webp');
    await this.storage.put(keys.detail, detail, 'image/webp');

    const old = item.photoKeys;
    item.photoKeys = keys;
    await this.itemsRepo.save(item);
    await this.deleteQuietly(old);

    await this.auditLogs.log({
      action: 'fnb_item.photo_updated',
      entityType: 'fnb_item',
      entityId: item.id,
      actorId: user.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: user.hotelId,
        diff: { photo: { from: old?.thumb ?? null, to: keys.thumb } },
      },
    });
    return this.menus.toItemView(item);
  }

  async removePhoto(
    user: TenantUser,
    itemId: string,
  ): Promise<FnbItemManageView> {
    const item = await this.menus.findItem(user.hotelId, itemId);
    const old = item.photoKeys;
    if (old) {
      item.photoKeys = null;
      await this.itemsRepo.save(item);
      await this.deleteQuietly(old);
      await this.auditLogs.log({
        action: 'fnb_item.photo_updated',
        entityType: 'fnb_item',
        entityId: item.id,
        actorId: user.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: user.hotelId,
          diff: { photo: { from: old.thumb, to: null } },
        },
      });
    }
    return this.menus.toItemView(item);
  }

  /** Best-effort cleanup — a missing object never fails the mutation. */
  private async deleteQuietly(keys: FnbPhotoKeys | null): Promise<void> {
    if (!keys) return;
    for (const key of [keys.thumb, keys.detail]) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`Failed to delete photo object ${key}: ${err}`);
      }
    }
  }
}
