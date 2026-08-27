import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { GuestHotelInfoService } from './guest-hotel-info.service';
import { HotelInfoEntry } from './hotel-info-entry.entity';

const makeStay = (o: Record<string, unknown> = {}) =>
  ({
    id: 'stay-1',
    hotelId: 'hotel-1',
    language: 'ru',
    hotel: {
      id: 'hotel-1',
      checkoutTime: '11:30',
      timezone: 'Africa/Cairo',
    },
    ...o,
  }) as unknown as Stay;

const makeEntry = (o: Record<string, unknown> = {}) =>
  ({
    id: 'entry-1',
    hotelId: 'hotel-1',
    section: 'facilities',
    names: { ar: 'المسبح', en: 'Pool' },
    descriptions: null,
    structured: {},
    photos: [],
    sortOrder: 0,
    isActive: true,
    ...o,
  }) as unknown as HotelInfoEntry;

const accessState = (o: Record<string, unknown> = {}) => ({
  hotelStatus: 'active',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  enabledModules: ['hotel_info'],
  planNameEn: 'Pro',
  planNameAr: 'برو',
  trialDaysRemaining: null,
  readOnly: false,
  ...o,
});

describe('guest hotel info (17.2)', () => {
  let service: GuestHotelInfoService;
  let repo: { find: jest.Mock };
  let access: { getAccessState: jest.Mock };

  beforeEach(async () => {
    repo = { find: jest.fn().mockResolvedValue([]) };
    access = { getAccessState: jest.fn().mockResolvedValue(accessState()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestHotelInfoService,
        { provide: getRepositoryToken(HotelInfoEntry), useValue: repo },
        { provide: TenantAccessService, useValue: access },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, fallback: number) => fallback) },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestHotelInfoService);
  });

  it('AC3 — localizes per entry with EN fallback', async () => {
    repo.find.mockResolvedValue([
      makeEntry({
        id: 'f1',
        names: { ar: 'المسبح', en: 'Pool', ru: 'Бассейн' },
        descriptions: { en: 'Open daily' },
      }),
      makeEntry({ id: 'f2', names: { ar: 'الصالة', en: 'Gym' }, sortOrder: 1 }),
    ]);
    const info = await service.getHotelInfo(makeStay());
    expect(info.facilities[0].name).toBe('Бассейн');
    expect(info.facilities[0].description).toBe('Open daily');
    expect(info.facilities[1].name).toBe('Gym');
  });

  it('AC2/AC4 — queries active entries only, sections ordered, empty sections empty', async () => {
    // Inactive rows never leave the DB — the where clause below is the AC4
    // contract (the mocked repo honors it implicitly).
    repo.find.mockResolvedValue([
      makeEntry({ id: 'f2', sortOrder: 2 }),
      makeEntry({ id: 'f1', sortOrder: 1 }),
      makeEntry({
        id: 'r1',
        section: 'house_rules',
        names: { ar: 'هدوء', en: 'Quiet hours' },
        descriptions: { en: '22:00–08:00' },
      }),
    ]);
    const info = await service.getHotelInfo(makeStay());
    expect(repo.find).toHaveBeenCalledWith({
      where: { hotelId: 'hotel-1', isActive: true },
    });
    expect(info.facilities.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(info.services).toEqual([]);
    expect(info.houseRules[0].description).toBe('22:00–08:00');
    expect(info.essentials).toBeNull();
    expect(info.about).toBeNull();
  });

  it('AC1/spec note 4 — essentials projects checkoutTime from the hotel, wifi verbatim', async () => {
    repo.find.mockResolvedValue([
      makeEntry({
        id: 'ess',
        section: 'essentials',
        names: {},
        structured: {
          wifiName: 'Lobby WiFi',
          wifiPassword: 'sunrise2026',
          receptionPhone: '+20 100 000 0000',
        },
      }),
    ]);
    const info = await service.getHotelInfo(makeStay());
    expect(info.essentials).toEqual({
      wifiName: 'Lobby WiFi',
      wifiPassword: 'sunrise2026',
      receptionPhone: '+20 100 000 0000',
      whatsapp: null,
      emergencyPhone: null,
      checkoutTime: '11:30',
    });
  });

  it('facilities expose windows + localized location note + photo urls', async () => {
    repo.find.mockResolvedValue([
      makeEntry({
        structured: {
          windows: [{ start: '20:00', end: '02:00' }],
          locationNote: { en: 'Building B', ru: 'Корпус Б' },
        },
        photos: [{ id: 'p1', thumb: 'kt', detail: 'kd' }],
      }),
    ]);
    const info = await service.getHotelInfo(makeStay());
    expect(info.facilities[0].windows).toEqual([
      { start: '20:00', end: '02:00' },
    ]);
    expect(info.facilities[0].locationNote).toBe('Корпус Б');
    expect(info.facilities[0].photoThumbUrl).toBe('files/kt');
    expect(info.facilities[0].photoDetailUrl).toBe('files/kd');
  });

  it('about exposes localized text and the gallery', async () => {
    repo.find.mockResolvedValue([
      makeEntry({
        section: 'about',
        names: {},
        descriptions: { en: 'A calm beach hotel.\n\nSince 1998.' },
        photos: [{ id: 'p1', thumb: 'kt', detail: 'kd' }],
      }),
    ]);
    const info = await service.getHotelInfo(makeStay());
    expect(info.about?.text).toBe('A calm beach hotel.\n\nSince 1998.');
    expect(info.about?.gallery).toEqual([
      { thumbUrl: 'files/kt', detailUrl: 'files/kd' },
    ]);
  });

  it('module gating — module off → MODULE_NOT_ENABLED, unavailable hotel → HOTEL_UNAVAILABLE', async () => {
    access.getAccessState.mockResolvedValue(
      accessState({ enabledModules: [] }),
    );
    await expect(service.getHotelInfo(makeStay())).rejects.toMatchObject({
      response: { code: 'MODULE_NOT_ENABLED', module: 'hotel_info' },
    });
    access.getAccessState.mockResolvedValue(accessState({ readOnly: true }));
    await expect(service.getHotelInfo(makeStay())).rejects.toMatchObject({
      response: { code: 'HOTEL_UNAVAILABLE' },
    });
  });

  it('spec note 2 — caches per hotel+language for 60s; language gets its own key', async () => {
    repo.find.mockResolvedValue([makeEntry()]);
    await service.getHotelInfo(makeStay());
    await service.getHotelInfo(makeStay());
    expect(repo.find).toHaveBeenCalledTimes(1);
    await service.getHotelInfo(makeStay({ language: 'de' }));
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
