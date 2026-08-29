import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { IMMUTABLE_RENDITION_PREFIXES } from '../renditions/rendition.constants';
import { STORAGE_DRIVER, StorageDriver } from './storage.interface';

/** Stored keys only ever contain these characters (see uploadLogo). */
const SAFE_KEY = /^[A-Za-z0-9/_.-]+$/;

/**
 * Serves stored objects by key, identically for the local and S3 drivers.
 * Public: logos must be reachable from the guest app and tenant dashboards.
 *
 * Uploads are user-controlled (e.g. hotel logos), so served bytes are treated
 * as hostile: a malicious SVG can carry inline <script>. The CSP + sandbox +
 * nosniff + attachment-disposition headers neutralize active content even on
 * this same origin, and the key is allowlisted against traversal / smuggling.
 */
@Controller('files')
export class FilesController {
  constructor(
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Public()
  @Get('*')
  async serve(@Param('0') key: string, @Res() res: Response) {
    if (!SAFE_KEY.test(key) || key.includes('..')) {
      throw new BadRequestException('Invalid file key');
    }
    const { data, contentType } = await this.storage.get(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Defuse any active content (notably SVG <script>) even same-origin.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader('Content-Disposition', 'inline; filename="asset"');
    // F&B / hotel-info / branding photo renditions live under uuid keys that
    // are never overwritten (a new upload = new keys), so they cache
    // immutably (Epic 16 note 6; Epic 17 decision 9; Epic 18.2 AC4).
    res.setHeader(
      'Cache-Control',
      IMMUTABLE_RENDITION_PREFIXES.some((p) => key.startsWith(p))
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    );
    res.send(data);
  }
}
