import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';

export interface PdfRenderOptions {
  format: 'A4' | 'A5';
  landscape?: boolean;
}

/**
 * Story 11.5 — the single Playwright entry point every print-ready PDF
 * (poster, room cards, and any future print artifact) renders through. The
 * templates hand it a complete, self-contained HTML string (fonts/images
 * inline — no network calls needed), never the other way around.
 *
 * Chromium is a lazy singleton: the first `render()` call launches it, every
 * later call reuses the same browser instance (a fresh *page* per render,
 * closed in `finally`), and Nest closes it on shutdown via
 * `onModuleDestroy` — tests never launch a real browser (mock this service).
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  async render(html: string, opts: PdfRenderOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle' });
      return await page.pdf({
        format: opts.format,
        landscape: opts.landscape ?? false,
        printBackground: true,
      });
    } finally {
      await page.close();
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch();
    }
    return this.browserPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    this.browserPromise = null;
    await browser.close();
  }
}
