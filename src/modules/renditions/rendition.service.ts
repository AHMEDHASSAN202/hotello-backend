import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.interface';
import { RenditionPreset } from './rendition.interface';

/**
 * Story 21.1 AC1 — shared server-side resize pipeline, extracted from the
 * F&B / Hotel Info / Branding photo services (which were duplicating the
 * same sharp + storage.put dance with only the preset numbers differing).
 * No repo deps: callers own their own entity, cap checks, and error codes —
 * this service only knows how to turn a buffer into stored WebP renditions.
 */
@Injectable()
export class RenditionService {
  private readonly logger = new Logger(RenditionService.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  /**
   * Renders every preset entry to WebP. Sharp exceptions propagate
   * uncaught — callers wrap this in their own try/catch to surface their
   * own `BadRequestException` + error code for an unreadable upload.
   */
  async render(buffer: Buffer, preset: RenditionPreset): Promise<Record<string, Buffer>> {
    const entries = Object.entries(preset);
    const buffers = await Promise.all(
      entries.map(([, spec]) =>
        sharp(buffer)
          .rotate()
          .resize(spec.width, spec.height, {
            fit: spec.fit,
            withoutEnlargement: spec.withoutEnlargement,
          })
          .webp({ quality: spec.quality })
          .toBuffer(),
      ),
    );
    const renditions: Record<string, Buffer> = {};
    entries.forEach(([name], i) => {
      renditions[name] = buffers[i];
    });
    return renditions;
  }

  /**
   * Renders and persists every preset entry under a fresh uuid key, so a
   * replace never overwrites the previous object (immutable-cache safe).
   * `ownerSegments` lets callers nest under an owning record (an item id,
   * an entry id) or omit it entirely for a one-per-hotel asset (branding).
   */
  async store(
    hotelId: string,
    prefix: string,
    ownerSegments: string[],
    preset: RenditionPreset,
    buffer: Buffer,
  ): Promise<Record<string, string>> {
    const base = [prefix, hotelId, ...ownerSegments, randomUUID()].join('/');
    const renditions = await this.render(buffer, preset);
    const keys: Record<string, string> = {};
    await Promise.all(
      Object.entries(renditions).map(async ([name, buf]) => {
        const key = `${base}-${name}.webp`;
        await this.storage.put(key, buf, 'image/webp');
        keys[name] = key;
      }),
    );
    return keys;
  }

  /** Best-effort cleanup — a missing/failed delete never fails the mutation. */
  async deleteQuietly(keys: Array<string | null | undefined>): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`Failed to delete rendition object ${key}: ${err}`);
      }
    }
  }
}
