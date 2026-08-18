import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

export type QrFormat = 'png' | 'svg';

export interface QrResult {
  body: Buffer | string;
  contentType: 'image/png' | 'image/svg+xml';
}

/**
 * Story 11.5 AC3/AC4 — a thin wrapper around `qrcode`: given a guest URL
 * (built by `TenantUrlsService`, never stored) and a format, returns the
 * derived image bytes. Nothing here touches hotels/rooms — QR codes for any
 * future guest-URL shape (rooms, general, F&B locations) reuse this as-is.
 * Error correction level M + margin 2 keep printed cards scan-safe.
 */
@Injectable()
export class RoomQrService {
  /**
   * Story 11.5 — a base64 `data:image/png;base64,...` URI for embedding a QR
   * directly in a PDF template's `<img src>` (no temp file, no second HTTP
   * hop for Chromium to resolve). Same error-correction/margin discipline as
   * `generate()`; a fixed 600px width gives print-safe module density at the
   * ~90mm poster / ~45mm card sizes the templates render it at.
   */
  async toDataUrl(url: string): Promise<string> {
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 600,
    });
  }

  async generate(url: string, format: QrFormat): Promise<QrResult> {
    if (format === 'svg') {
      const body = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      return { body, contentType: 'image/svg+xml' };
    }

    const body = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'M',
      width: 1024,
      margin: 2,
    });
    return { body, contentType: 'image/png' };
  }
}
