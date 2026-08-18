import { chromium } from 'playwright';
import { PdfRendererService } from './pdf-renderer.service';

jest.mock('playwright', () => ({
  chromium: { launch: jest.fn() },
}));

const launchMock = chromium.launch as jest.Mock;

function makeBrowser(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: jest.fn().mockReturnValue(true),
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePage(pdfBytes: Buffer) {
  return {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(pdfBytes),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PdfRendererService (11.5 — self-healing chromium launch, review round 1)', () => {
  let service: PdfRendererService;

  beforeEach(() => {
    service = new PdfRendererService();
    launchMock.mockReset();
  });

  it('renders via a lazily-launched browser and returns the PDF buffer', async () => {
    const pdfBytes = Buffer.from('%PDF-fake');
    const page = makePage(pdfBytes);
    const browser = makeBrowser({ newPage: jest.fn().mockResolvedValue(page) });
    launchMock.mockResolvedValue(browser);

    const result = await service.render('<html></html>', { format: 'A4' });

    expect(result).toEqual(pdfBytes);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(page.setContent).toHaveBeenCalledWith('<html></html>', {
      waitUntil: 'networkidle',
    });
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'A4',
      landscape: false,
      printBackground: true,
    });
    expect(page.close).toHaveBeenCalled();
  });

  it('reuses the same browser across renders (lazy singleton — one launch only)', async () => {
    const page1 = makePage(Buffer.from('a'));
    const page2 = makePage(Buffer.from('b'));
    const browser = makeBrowser({
      newPage: jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2),
    });
    launchMock.mockResolvedValue(browser);

    await service.render('<html>1</html>', { format: 'A4' });
    await service.render('<html>2</html>', { format: 'A5' });

    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('AC (review round 1a) — a rejected launch is not cached forever: the next call retries and can succeed', async () => {
    launchMock.mockRejectedValueOnce(new Error('chromium failed to launch'));

    await expect(service.render('<html></html>', { format: 'A4' })).rejects.toThrow(
      'chromium failed to launch',
    );

    const page = makePage(Buffer.from('%PDF-recovered'));
    const browser = makeBrowser({ newPage: jest.fn().mockResolvedValue(page) });
    launchMock.mockResolvedValueOnce(browser);

    const result = await service.render('<html></html>', { format: 'A4' });

    expect(result).toEqual(Buffer.from('%PDF-recovered'));
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('AC (review round 1b) — a disconnected browser triggers a relaunch instead of reuse', async () => {
    const deadPage = makePage(Buffer.from('unused'));
    const deadBrowser = makeBrowser({
      isConnected: jest.fn().mockReturnValue(false),
      newPage: jest.fn().mockResolvedValue(deadPage),
    });
    launchMock.mockResolvedValueOnce(deadBrowser);

    // First render launches the (soon-to-be-dead) browser and succeeds once.
    await service.render('<html></html>', { format: 'A4' });
    expect(launchMock).toHaveBeenCalledTimes(1);

    // Browser has since crashed/disconnected (isConnected -> false from now on).
    const freshPage = makePage(Buffer.from('%PDF-fresh'));
    const freshBrowser = makeBrowser({ newPage: jest.fn().mockResolvedValue(freshPage) });
    launchMock.mockResolvedValueOnce(freshBrowser);

    const result = await service.render('<html></html>', { format: 'A4' });

    expect(result).toEqual(Buffer.from('%PDF-fresh'));
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('onModuleDestroy closes the launched browser and clears the singleton', async () => {
    const page = makePage(Buffer.from('%PDF-x'));
    const browser = makeBrowser({ newPage: jest.fn().mockResolvedValue(page) });
    launchMock.mockResolvedValue(browser);
    await service.render('<html></html>', { format: 'A4' });

    await service.onModuleDestroy();
    expect(browser.close).toHaveBeenCalled();

    // The field is cleared — a render() call after destroy launches fresh.
    await service.render('<html></html>', { format: 'A4' });
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('onModuleDestroy is a no-op when the browser was never launched', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('onModuleDestroy tolerates a browser whose launch had failed (nothing to close)', async () => {
    launchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(service.render('<html></html>', { format: 'A4' })).rejects.toThrow('boom');

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
