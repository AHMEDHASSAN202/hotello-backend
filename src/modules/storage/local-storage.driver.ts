import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import {
  EXTENSION_CONTENT_TYPES,
  StorageDriver,
  StoredObject,
} from './storage.interface';

export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly basePath: string) {}

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.resolve(key);
    try {
      const data = await readFile(path);
      return { data, contentType: this.contentTypeFor(key) };
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Keys are storage-internal, but reject traversal defensively. */
  private resolve(key: string): string {
    const normalized = normalize(key);
    if (normalized.startsWith('..') || normalized.includes('../')) {
      throw new BadRequestException('Invalid storage key');
    }
    return join(this.basePath, normalized);
  }

  private contentTypeFor(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream';
  }
}
