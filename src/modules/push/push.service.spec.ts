import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Stay } from '../tenant-stays/stay.entity';
import { PushService } from './push.service';
import { PushDispatchService } from './push-dispatch.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

describe('PushService.notify (23.1 AC5)', () => {
  let service: PushService;
  let staysRepo: { find: jest.Mock };
  let subscriptions: { findByStayIds: jest.Mock };
  let dispatch: { enqueueAndSend: jest.Mock; statsForRefs: jest.Mock };
  let config: { get: jest.Mock };

  const hotel = { id: 'hotel-1', slug: 'sunrise', timezone: 'Africa/Cairo' };

  const makeStay = (overrides: Partial<Stay> = {}): Stay =>
    ({
      id: 'stay-1',
      hotelId: 'hotel-1',
      status: 'active',
      language: 'en',
      stayType: 'room_only',
      roomId: 'room-1',
      room: { id: 'room-1', floor: 3 } as Stay['room'],
      hotel,
      ...overrides,
    }) as Stay;

  const makeSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    hotelId: 'hotel-1',
    stayId: 'stay-1',
    endpoint: 'https://push.example/1',
    ...overrides,
  });

  beforeEach(async () => {
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    subscriptions = { findByStayIds: jest.fn().mockResolvedValue([]) };
    dispatch = {
      enqueueAndSend: jest.fn().mockResolvedValue(undefined),
      statsForRefs: jest.fn().mockResolvedValue(new Map()),
    };
    config = { get: jest.fn((_key: string, def: unknown) => def) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: PushSubscriptionsService, useValue: subscriptions },
        { provide: PushDispatchService, useValue: dispatch },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(PushService);
  });

  it('resolves an audience filter to active stays via matchesAudience and fans out to every device', async () => {
    const matching = makeStay({
      id: 'stay-1',
      room: { id: 'room-1', floor: 3 } as Stay['room'],
    });
    const nonMatching = makeStay({
      id: 'stay-2',
      room: { id: 'room-2', floor: 5 } as Stay['room'],
    });
    staysRepo.find.mockResolvedValue([matching, nonMatching]);
    subscriptions.findByStayIds.mockResolvedValue([
      makeSub({ id: 'sub-1', stayId: 'stay-1' }),
      makeSub({ id: 'sub-2', stayId: 'stay-1' }),
    ]);

    await service.notify(
      'hotel-1',
      { audience: { floors: [3] } },
      'order_status',
      { refId: 'order-1', vars: { status: 'preparing', itemCount: 2, locationLine: null } },
    );

    // Only active stays of the hotel are loaded, and matchesAudience filters to floor 3.
    expect(staysRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotelId: 'hotel-1', status: 'active' } }),
    );
    expect(subscriptions.findByStayIds).toHaveBeenCalledWith(['stay-1']);
    expect(dispatch.enqueueAndSend).toHaveBeenCalledTimes(1);
    const inputs = dispatch.enqueueAndSend.mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    expect(inputs.every((i: { stayId: string }) => i.stayId === 'stay-1')).toBe(true);
  });

  it('stayIds target loads only active stays of that hotel (checked_out excluded)', async () => {
    const active = makeStay({ id: 'stay-1' });
    staysRepo.find.mockResolvedValue([active]);
    subscriptions.findByStayIds.mockResolvedValue([makeSub({ id: 'sub-1', stayId: 'stay-1' })]);

    await service.notify(
      'hotel-1',
      { stayIds: ['stay-1', 'stay-2'] },
      'order_status',
      { refId: 'order-1', vars: { status: 'preparing', itemCount: 1, locationLine: null } },
    );

    expect(staysRepo.find).toHaveBeenCalledWith({
      where: { id: expect.anything(), hotelId: 'hotel-1', status: 'active' },
      relations: ['hotel', 'room'],
    });
    expect(subscriptions.findByStayIds).toHaveBeenCalledWith(['stay-1']);
    const inputs = dispatch.enqueueAndSend.mock.calls[0][0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].stayId).toBe('stay-1');
  });

  it('composes per-stay language: ar stay gets ar copy, de stay gets de copy', async () => {
    const arStay = makeStay({ id: 'stay-ar', language: 'ar' });
    const deStay = makeStay({ id: 'stay-de', language: 'de' });
    staysRepo.find.mockResolvedValue([arStay, deStay]);
    subscriptions.findByStayIds.mockResolvedValue([
      makeSub({ id: 'sub-ar', stayId: 'stay-ar' }),
      makeSub({ id: 'sub-de', stayId: 'stay-de' }),
    ]);

    await service.notify(
      'hotel-1',
      { stayIds: ['stay-ar', 'stay-de'] },
      'order_status',
      {
        refId: 'order-1',
        vars: { status: 'preparing', itemCount: 1, locationLine: null },
      },
    );

    const inputs = dispatch.enqueueAndSend.mock.calls[0][0];
    const arInput = inputs.find((i: { stayId: string }) => i.stayId === 'stay-ar');
    const deInput = inputs.find((i: { stayId: string }) => i.stayId === 'stay-de');
    expect(arInput.title).not.toEqual(deInput.title);
    expect(arInput.body).not.toEqual(deInput.body);
  });

  it('quiet-hours type + inside window → deliverAfter set to window end; priority bypasses', async () => {
    // 03:00 Africa/Cairo (UTC+2/+3 depending on DST) falls inside the default 22:00-08:00 window.
    const stay = makeStay({ id: 'stay-1', language: 'en' });
    staysRepo.find.mockResolvedValue([stay]);
    subscriptions.findByStayIds.mockResolvedValue([makeSub({ id: 'sub-1', stayId: 'stay-1' })]);

    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T01:00:00.000Z')); // ~03:00 Cairo
    try {
      await service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'announcement',
        {
          refId: 'ann-1',
          vars: { id: 'ann-1', titles: { en: 'Title' }, bodies: { en: 'Body' } },
        },
      );
      let inputs = dispatch.enqueueAndSend.mock.calls[0][0];
      expect(inputs[0].deliverAfter).not.toBeNull();

      dispatch.enqueueAndSend.mockClear();

      await service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'announcement',
        {
          refId: 'ann-1',
          priority: true,
          vars: { id: 'ann-1', titles: { en: 'Title' }, bodies: { en: 'Body' } },
        },
      );
      inputs = dispatch.enqueueAndSend.mock.calls[0][0];
      expect(inputs[0].deliverAfter).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('quiet-hours-exempt types (order_status) never hold', async () => {
    const stay = makeStay({ id: 'stay-1', language: 'en' });
    staysRepo.find.mockResolvedValue([stay]);
    subscriptions.findByStayIds.mockResolvedValue([makeSub({ id: 'sub-1', stayId: 'stay-1' })]);

    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T01:00:00.000Z')); // ~03:00 Cairo
    try {
      await service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'order_status',
        { refId: 'order-1', vars: { status: 'preparing', itemCount: 1, locationLine: null } },
      );
      const inputs = dispatch.enqueueAndSend.mock.calls[0][0];
      expect(inputs[0].deliverAfter).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('no subscriptions → no dispatch calls, no error', async () => {
    staysRepo.find.mockResolvedValue([makeStay({ id: 'stay-1' })]);
    subscriptions.findByStayIds.mockResolvedValue([]);

    await expect(
      service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'order_status',
        { refId: 'order-1', vars: { status: 'preparing', itemCount: 1, locationLine: null } },
      ),
    ).resolves.toBeUndefined();

    expect(dispatch.enqueueAndSend).not.toHaveBeenCalled();
  });

  it('never throws: dispatch service explosion is swallowed and logged', async () => {
    staysRepo.find.mockResolvedValue([makeStay({ id: 'stay-1' })]);
    subscriptions.findByStayIds.mockResolvedValue([makeSub({ id: 'sub-1', stayId: 'stay-1' })]);
    dispatch.enqueueAndSend.mockRejectedValue(new Error('boom'));

    await expect(
      service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'order_status',
        { refId: 'order-1', vars: { status: 'preparing', itemCount: 1, locationLine: null } },
      ),
    ).resolves.toBeUndefined();
  });

  it('never throws: a DB lookup explosion (staysRepo.find) is swallowed too', async () => {
    staysRepo.find.mockRejectedValue(new Error('db down'));

    await expect(
      service.notify(
        'hotel-1',
        { stayIds: ['stay-1'] },
        'order_status',
        { refId: 'order-1', vars: { status: 'preparing', itemCount: 1, locationLine: null } },
      ),
    ).resolves.toBeUndefined();
  });

  it('builds dedupeKey per subscription from dedupePrefix', async () => {
    staysRepo.find.mockResolvedValue([makeStay({ id: 'stay-1' })]);
    subscriptions.findByStayIds.mockResolvedValue([
      makeSub({ id: 'sub-1', stayId: 'stay-1' }),
      makeSub({ id: 'sub-2', stayId: 'stay-1' }),
    ]);

    await service.notify(
      'hotel-1',
      { stayIds: ['stay-1'] },
      'checkout_reminder',
      {
        refId: null,
        dedupePrefix: 'checkout-reminder-2026-01-15',
        vars: { checkoutTime: '12:00', hasUnsettledBalance: false },
      },
    );

    const inputs = dispatch.enqueueAndSend.mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    expect(inputs.find((i: { subscriptionId: string }) => i.subscriptionId === 'sub-1').dedupeKey).toBe(
      'checkout-reminder-2026-01-15:sub-1',
    );
    expect(inputs.find((i: { subscriptionId: string }) => i.subscriptionId === 'sub-2').dedupeKey).toBe(
      'checkout-reminder-2026-01-15:sub-2',
    );
  });

  it('statsForRefs delegates to PushDispatchService', async () => {
    const map = new Map([['ref-1', { sent: 2, failed: 1 }]]);
    dispatch.statsForRefs.mockResolvedValue(map);

    const result = await service.statsForRefs(['ref-1']);

    expect(dispatch.statsForRefs).toHaveBeenCalledWith(['ref-1']);
    expect(result).toBe(map);
  });
});
