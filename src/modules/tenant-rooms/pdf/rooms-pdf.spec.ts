import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Hotel } from '../../hotels/hotel.entity';
import { TenantUrlsService } from '../../hotels/tenant-urls.service';
import { STORAGE_DRIVER } from '../../storage/storage.interface';
import { Room } from '../room.entity';
import { RoomQrService } from '../room-qr.service';
import { cardsTemplate } from './cards.template';
import { PdfRendererService } from './pdf-renderer.service';
import { posterTemplate } from './poster.template';
import { BRAND_GOLD, BRAND_NAVY, SCAN_PROMPT_LINES } from './print.constants';
import { RoomsPdfService } from './rooms-pdf.service';

const NO_EXTERNAL_URL = /https?:\/\//;

describe('posterTemplate (11.5)', () => {
  const base = {
    hotelNameEn: 'Sunrise Hotel',
    hotelNameAr: 'فندق شروق',
    logoDataUri: null as string | null,
    qrDataUri: 'data:image/png;base64,AAAA',
    size: 'A4' as const,
  };

  it('AC1 — contains hotel name (EN + AR), the QR data URI, and "Powered by GXP" footer', () => {
    const html = posterTemplate(base);
    expect(html).toContain('Sunrise Hotel');
    expect(html).toContain('فندق شروق');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('Powered by GXP');
  });

  it('AC1 — includes the scan prompt in all five languages from SCAN_PROMPT_LINES, AR line dir="rtl"', () => {
    const html = posterTemplate(base);
    for (const line of SCAN_PROMPT_LINES) {
      expect(html).toContain(line.poster);
    }
    const arLineMatch = html.match(/<p[^>]*dir="rtl"[^>]*lang="ar"[^>]*>([^<]*)<\/p>/);
    expect(arLineMatch).not.toBeNull();
    expect(arLineMatch![1]).toBe(
      SCAN_PROMPT_LINES.find((l) => l.lang === 'ar')!.poster,
    );
  });

  it('AC1 — embeds brand colors #0E2A47/#C8A24A and @font-face for both Noto families', () => {
    const html = posterTemplate(base);
    expect(html).toContain(BRAND_NAVY);
    expect(html).toContain(BRAND_GOLD);
    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Noto Sans'");
    expect(html).toContain("font-family: 'Noto Kufi Arabic'");
  });

  it('AC1 — no external URLs anywhere (fonts/images inline: data: or file: only)', () => {
    const html = posterTemplate({
      ...base,
      logoDataUri: 'data:image/png;base64,LOGO',
    });
    expect(html).not.toMatch(NO_EXTERNAL_URL);
    // fonts are loaded via file:// — sanity-check at least one is present.
    expect(html).toContain('file://');
  });

  it('renders the logo lockup when logoDataUri is null, the <img> when it is set', () => {
    const withoutLogo = posterTemplate(base);
    expect(withoutLogo).not.toContain('<img class="logo"');

    const withLogo = posterTemplate({
      ...base,
      logoDataUri: 'data:image/png;base64,LOGO',
    });
    expect(withLogo).toContain('<img class="logo" src="data:image/png;base64,LOGO"');
  });

  it('sets the requested @page size (A4 or A5)', () => {
    expect(posterTemplate(base)).toContain('@page { size: A4; margin: 0; }');
    expect(posterTemplate({ ...base, size: 'A5' })).toContain(
      '@page { size: A5; margin: 0; }',
    );
  });

  it('scales the QR and layout down for A5 — a same-scale A4 poster overflows onto a second page', () => {
    const a4Html = posterTemplate(base);
    const a5Html = posterTemplate({ ...base, size: 'A5' });
    const a4Qr = Number(a4Html.match(/\.qr-wrap img \{ width: (\d+(?:\.\d+)?)mm/)![1]);
    const a5Qr = Number(a5Html.match(/\.qr-wrap img \{ width: (\d+(?:\.\d+)?)mm/)![1]);
    expect(a5Qr).toBeLessThan(a4Qr);
  });
});

describe('cardsTemplate (11.5)', () => {
  const base = {
    hotelNameEn: 'Sunrise Hotel',
    hotelNameAr: 'فندق شروق',
    logoDataUri: null as string | null,
    cards: [
      { roomNumber: '101', qrDataUri: 'data:image/png;base64,ROOM101' },
      { roomNumber: '102', qrDataUri: 'data:image/png;base64,ROOM102' },
    ],
  };

  it('AC2 — renders one card per room with room number + its QR + hotel identity', () => {
    const html = cardsTemplate(base);
    expect(html).toContain('101');
    expect(html).toContain('data:image/png;base64,ROOM101');
    expect(html).toContain('102');
    expect(html).toContain('data:image/png;base64,ROOM102');
    expect(html).toContain('Sunrise Hotel');
    expect(html).toContain('فندق شروق');
    expect(html.match(/class="card"/g)?.length).toBe(2);
  });

  it('AC2 — 4 cards per A4 sheet (A6 size) with dashed cut guides; page-break rows every 2 cards', () => {
    const eightCards = Array.from({ length: 8 }, (_, i) => ({
      roomNumber: `${100 + i}`,
      qrDataUri: `data:image/png;base64,ROOM${i}`,
    }));
    const html = cardsTemplate({ ...base, cards: eightCards });

    expect(html).toContain('grid-template-columns: 105mm 105mm');
    expect(html).toContain('grid-template-rows');
    expect(html).toContain('border: 1px dashed');
    expect(html.match(/class="card"/g)?.length).toBe(8);
    // 8 cards / 4 per sheet = 2 sheets, one page-break between them.
    expect(html.match(/page-break-before: always/g)?.length).toBe(1);
  });

  it('AC2 — card QR block is >= 34mm wide (>=2mm/module headroom for a v3 QR — note 9)', () => {
    const html = cardsTemplate(base);
    const widthMatch = html.match(/\.card-qr\s*\{[^}]*width:\s*(\d+(?:\.\d+)?)mm/);
    expect(widthMatch).not.toBeNull();
    expect(Number(widthMatch![1])).toBeGreaterThanOrEqual(34);
  });

  it('no external URLs anywhere', () => {
    const html = cardsTemplate(base);
    expect(html).not.toMatch(NO_EXTERNAL_URL);
  });
});

describe('generatePoster/generateCards service (11.5)', () => {
  let service: RoomsPdfService;
  let roomsRepo: { createQueryBuilder: jest.Mock };
  let hotelsRepo: { findOne: jest.Mock; update: jest.Mock };
  let renderer: { render: jest.Mock };
  let roomQr: { toDataUrl: jest.Mock };
  let tenantUrls: { buildGuestUrl: jest.Mock };
  let storage: { get: jest.Mock };
  let qb: Record<string, jest.Mock>;

  const HOTEL_ID = 'hotel-1';
  const hotel = {
    id: HOTEL_ID,
    slug: 'sunrise',
    nameEn: 'Sunrise Hotel',
    nameAr: 'فندق شروق',
    logoPath: null as string | null,
    qrGeneratedAt: null as Date | null,
  };

  const rooms = [
    { id: 'r1', hotelId: HOTEL_ID, roomNumber: '101', floor: 1, status: 'active' },
    { id: 'r2', hotelId: HOTEL_ID, roomNumber: '102', floor: 1, status: 'active' },
  ];

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rooms),
    };
    roomsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    hotelsRepo = {
      findOne: jest.fn().mockResolvedValue({ ...hotel }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    renderer = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
    roomQr = { toDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR') };
    tenantUrls = {
      buildGuestUrl: jest.fn((slug: string, params?: Record<string, string>) =>
        params ? `https://guest.example/${slug}?room=${params.room}` : `https://guest.example/${slug}`,
      ),
    };
    storage = { get: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RoomsPdfService,
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: PdfRendererService, useValue: renderer },
        { provide: RoomQrService, useValue: roomQr },
        { provide: TenantUrlsService, useValue: tenantUrls },
        { provide: STORAGE_DRIVER, useValue: storage },
      ],
    }).compile();

    service = module.get(RoomsPdfService);
  });

  it('renders via PdfRendererService and returns the buffer (nothing persisted)', async () => {
    const buffer = await service.generatePoster(HOTEL_ID, 'A4');
    expect(buffer).toEqual(Buffer.from('%PDF-fake'));
    expect(renderer.render).toHaveBeenCalledWith(expect.any(String), { format: 'A4' });
    expect(roomQr.toDataUrl).toHaveBeenCalledWith('https://guest.example/sunrise');
  });

  it('sets hotels.qrGeneratedAt on first generation only', async () => {
    await service.generatePoster(HOTEL_ID, 'A4');
    expect(hotelsRepo.update).toHaveBeenCalledTimes(1);
    expect(hotelsRepo.update).toHaveBeenCalledWith(
      { id: HOTEL_ID },
      { qrGeneratedAt: expect.any(Date) },
    );

    hotelsRepo.update.mockClear();
    hotelsRepo.findOne.mockResolvedValue({ ...hotel, qrGeneratedAt: new Date('2026-01-01') });
    await service.generatePoster(HOTEL_ID, 'A4');
    expect(hotelsRepo.update).not.toHaveBeenCalled();
  });

  it('cards scope floors/rooms filters hotel rooms; inactive rooms excluded', async () => {
    await service.generateCards(HOTEL_ID, { scope: 'all' } as any);
    expect(qb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', { hotelId: HOTEL_ID });
    expect(qb.andWhere).toHaveBeenCalledWith('r.status != :inactive', {
      inactive: 'inactive',
    });

    qb.andWhere.mockClear();
    await service.generateCards(HOTEL_ID, { scope: 'floors', floors: [1, 2] } as any);
    expect(qb.andWhere).toHaveBeenCalledWith('r.floor IN (:...floors)', {
      floors: [1, 2],
    });

    qb.andWhere.mockClear();
    await service.generateCards(HOTEL_ID, { scope: 'rooms', roomIds: ['r1'] } as any);
    expect(qb.andWhere).toHaveBeenCalledWith('r.id IN (:...roomIds)', {
      roomIds: ['r1'],
    });
  });

  it('cross-tenant roomIds are silently dropped (scoped query — isolation)', async () => {
    // The hotelId filter is always applied first — a foreign room id simply
    // finds no match in this hotel's scoped query (getMany already reflects
    // that via the mock; here we assert the query is always hotel-scoped
    // regardless of which room ids were requested).
    await service.generateCards(HOTEL_ID, {
      scope: 'rooms',
      roomIds: ['other-hotel-room'],
    } as any);
    expect(qb.where).toHaveBeenCalledWith('r.hotelId = :hotelId', { hotelId: HOTEL_ID });
  });

  it('throws NO_ROOMS_IN_SCOPE (400) when zero rooms match', async () => {
    qb.getMany.mockResolvedValue([]);
    await expect(
      service.generateCards(HOTEL_ID, { scope: 'floors', floors: [99] } as any),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'NO_ROOMS_IN_SCOPE', message: expect.any(String) },
    });
  });

  it('renders without a logo when the storage driver throws', async () => {
    hotelsRepo.findOne.mockResolvedValue({ ...hotel, logoPath: 'hotels/1/logo.png' });
    storage.get.mockRejectedValue(new Error('missing'));
    const buffer = await service.generatePoster(HOTEL_ID, 'A4');
    expect(buffer).toEqual(Buffer.from('%PDF-fake'));
    const html = renderer.render.mock.calls[0][0];
    expect(html).not.toContain('<img class="logo"');
  });

  it('embeds the logo as a base64 data URI when the storage driver succeeds', async () => {
    hotelsRepo.findOne.mockResolvedValue({ ...hotel, logoPath: 'hotels/1/logo.png' });
    storage.get.mockResolvedValue({
      data: Buffer.from('fake-bytes'),
      contentType: 'image/png',
    });
    await service.generatePoster(HOTEL_ID, 'A4');
    const html = renderer.render.mock.calls[0][0];
    expect(html).toContain('data:image/png;base64,');
  });
});
