import * as QRCode from 'qrcode';
import { RoomQrService } from './room-qr.service';

jest.mock('qrcode');

describe('RoomQrService.generate (11.5)', () => {
  let service: RoomQrService;
  const url = 'https://guest.gxp.example/sunrise?room=101';

  beforeEach(() => {
    service = new RoomQrService();
    jest.clearAllMocks();
  });

  it('AC3 — png returns a Buffer with image/png; svg returns a string with image/svg+xml', async () => {
    const buf = Buffer.from('fake-png');
    (QRCode.toBuffer as jest.Mock).mockResolvedValue(buf);
    (QRCode.toString as jest.Mock).mockResolvedValue('<svg></svg>');

    const png = await service.generate(url, 'png');
    expect(png.body).toBe(buf);
    expect(png.contentType).toBe('image/png');

    const svg = await service.generate(url, 'svg');
    expect(svg.body).toBe('<svg></svg>');
    expect(svg.contentType).toBe('image/svg+xml');
  });

  it('AC4 — uses error correction level M and margin >= 2 (print-scan safety)', async () => {
    (QRCode.toBuffer as jest.Mock).mockResolvedValue(Buffer.from('x'));
    (QRCode.toString as jest.Mock).mockResolvedValue('<svg></svg>');

    await service.generate(url, 'png');
    expect(QRCode.toBuffer).toHaveBeenCalledWith(url, {
      errorCorrectionLevel: 'M',
      width: 1024,
      margin: 2,
    });

    await service.generate(url, 'svg');
    expect(QRCode.toString).toHaveBeenCalledWith(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
    });
  });

  it('AC5 (11.5 PDF) — toDataUrl returns a data:image/png URI at 600px width, M/margin 2', async () => {
    (QRCode.toDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,AAAA');

    const dataUrl = await service.toDataUrl(url);
    expect(dataUrl).toBe('data:image/png;base64,AAAA');
    expect(QRCode.toDataURL).toHaveBeenCalledWith(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 600,
    });
  });
});
