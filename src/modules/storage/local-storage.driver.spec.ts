import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorageDriver } from './local-storage.driver';

describe('LocalStorageDriver', () => {
  let base: string;
  let driver: LocalStorageDriver;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'hotello-storage-'));
    driver = new LocalStorageDriver(base);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('round-trips put → get with a content type derived from the key', async () => {
    const data = Buffer.from('logo-bytes');
    await driver.put('hotels/h1/logo-1.png', data, 'image/png');

    const stored = await driver.get('hotels/h1/logo-1.png');
    expect(stored.data.equals(data)).toBe(true);
    expect(stored.contentType).toBe('image/png');
  });

  it('deletes objects and 404s on subsequent reads', async () => {
    await driver.put('hotels/h1/logo-1.webp', Buffer.from('x'), 'image/webp');
    await driver.delete('hotels/h1/logo-1.webp');
    await expect(driver.get('hotels/h1/logo-1.webp')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s for keys that never existed', async () => {
    await expect(driver.get('missing.png')).rejects.toThrow(NotFoundException);
  });

  it('rejects path traversal in keys', async () => {
    await expect(
      driver.put('../outside.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow(BadRequestException);
    await expect(driver.get('a/../../etc/passwd')).rejects.toThrow(
      BadRequestException,
    );
  });
});
