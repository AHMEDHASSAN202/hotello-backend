/**
 * Platform-wide upload abstraction (Epic 05 note 3). The DB stores storage
 * *keys* (e.g. `hotels/{id}/logo.png`), never URLs; drivers are swapped via
 * the STORAGE_DRIVER env var without touching callers.
 */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Throws NotFoundException when the key does not exist. */
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

/** Keys always carry an extension — content types derive from it. */
export const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
