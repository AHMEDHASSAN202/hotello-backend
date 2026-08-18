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

  /**
   * Self-healing lazy singleton — two failure modes guarded against:
   *  - `chromium.launch()` itself rejects (bad install, OOM, ...). Review
   *    round 1: the original version left the rejected promise cached in
   *    `browserPromise` forever, so every later `render()` replayed the same
   *    stale rejection until process restart. `launchBrowser()` now clears
   *    the field in its `catch` before rethrowing, so the NEXT call gets a
   *    fresh launch attempt instead of the cached error.
   *  - A previously-healthy browser crashes/disconnects mid-process. Caught
   *    here via `isConnected()` before reuse — a disconnected browser
   *    triggers a fresh launch rather than handing back a browser no page
   *    can open.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      if (browser.isConnected()) {
        return browser;
      }
      this.browserPromise = null;
    }
    this.browserPromise = this.launchBrowser();
    return this.browserPromise;
  }

  private async launchBrowser(): Promise<Browser> {
    try {
      return await chromium.launch();
    } catch (err) {
      // Don't cache a rejected launch forever (Task 9 review, round 1) — the
      // next render() call must get a fresh attempt, not the same stale error.
      this.browserPromise = null;
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => null);
    this.browserPromise = null;
    await browser?.close();
  }
}
