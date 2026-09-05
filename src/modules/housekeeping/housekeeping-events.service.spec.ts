import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HousekeepingEvent } from './housekeeping-event.entity';
import { HousekeepingEventsService } from './housekeeping-events.service';

describe('HousekeepingEventsService (Story 22.2 AC1/AC3)', () => {
  let service: HousekeepingEventsService;
  let repo: { insert: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    repo = { insert: jest.fn().mockResolvedValue({}), count: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HousekeepingEventsService,
        { provide: getRepositoryToken(HousekeepingEvent), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(HousekeepingEventsService);
  });

  it('inserts all fields, defaulting cleaningType/actorId/assignedToId to null when omitted', async () => {
    await service.record({
      hotelId: 'hotel-1',
      roomId: 'room-1',
      eventType: 'flagged',
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const arg = repo.insert.mock.calls[0][0];
    expect(arg).toMatchObject({
      hotelId: 'hotel-1',
      roomId: 'room-1',
      eventType: 'flagged',
      cleaningType: null,
      actorId: null,
      assignedToId: null,
    });
    expect(arg.occurredAt).toBeInstanceOf(Date);
  });

  it('passes through cleaningType/actorId/assignedToId when provided', async () => {
    await service.record({
      hotelId: 'hotel-1',
      roomId: 'room-1',
      eventType: 'completed',
      cleaningType: 'checkout',
      actorId: 'actor-1',
      assignedToId: 'assignee-1',
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cleaningType: 'checkout',
        actorId: 'actor-1',
        assignedToId: 'assignee-1',
      }),
    );
  });

  it('resolves without throwing when repo.insert rejects (never fails the caller)', async () => {
    repo.insert.mockRejectedValue(new Error('db down'));
    await expect(
      service.record({
        hotelId: 'hotel-1',
        roomId: 'room-1',
        eventType: 'flagged',
      }),
    ).resolves.toBeUndefined();
  });

  describe('countCompletedBy (26.5 AC2)', () => {
    it('counts completed events for the given hotel/actor since the given time', async () => {
      repo.count = jest.fn().mockResolvedValue(3);
      const since = new Date('2026-08-29T00:00:00Z');
      const result = await service.countCompletedBy('hotel-1', 'actor-1', since);
      expect(repo.count).toHaveBeenCalledWith({
        where: { hotelId: 'hotel-1', actorId: 'actor-1', eventType: 'completed', occurredAt: expect.anything() },
      });
      expect(result).toBe(3);
    });
  });
});
