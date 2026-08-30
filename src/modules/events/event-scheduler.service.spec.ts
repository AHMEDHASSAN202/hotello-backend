import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventSchedulerService } from './event-scheduler.service';
import { Event } from './event.entity';

const makeEvent = (o: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    hotelId: 'hotel-1',
    status: 'published',
    startAtLocal: '2026-01-15 12:00',
    endAtLocal: '2026-01-15 14:00',
    completedAt: null,
    hotel: { id: 'hotel-1', timezone: 'Africa/Cairo' },
    ...o,
  }) as unknown as Event;

describe('EventSchedulerService (21.2 AC2)', () => {
  let service: EventSchedulerService;
  let repo: Record<string, jest.Mock>;
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (e) => e),
    };
    auditLogs = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventSchedulerService,
        { provide: getRepositoryToken(Event), useValue: repo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(EventSchedulerService);
  });

  it('is idempotent by construction — the query only selects published rows', async () => {
    await service.transition(new Date('2026-01-15T10:00:00Z'));
    expect(repo.find).toHaveBeenCalledWith({
      where: { status: 'published' },
      relations: ['hotel'],
    });
  });

  it('completes a published event once the hotel-local clock passes endAtLocal', async () => {
    // Cairo is UTC+2 in winter: endAtLocal 14:00 local = 12:00Z.
    repo.find.mockResolvedValue([makeEvent()]);
    let result = await service.transition(new Date('2026-01-15T11:59:00Z'));
    expect(result).toEqual({ completed: 0 });
    expect(repo.save).not.toHaveBeenCalled();

    repo.find.mockResolvedValue([makeEvent()]);
    result = await service.transition(new Date('2026-01-15T12:01:00Z'));
    expect(result).toEqual({ completed: 1 });
    const saved = repo.save.mock.calls[0][0];
    expect(saved.status).toBe('completed');
    expect(saved.completedAt).toEqual(new Date('2026-01-15T12:01:00Z'));
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'event.completed',
        entityType: 'event',
        entityId: 'event-1',
        actorId: null,
        metadata: { actorType: 'system', hotelId: 'hotel-1' },
      }),
    );
  });

  it('completes an endless event (endAtLocal = null) only after start + 3h, not before', async () => {
    // startAtLocal 12:00 local + 180min = 15:00 local = 13:00Z.
    repo.find.mockResolvedValue([makeEvent({ endAtLocal: null })]);
    let result = await service.transition(new Date('2026-01-15T12:59:00Z'));
    expect(result).toEqual({ completed: 0 });
    expect(repo.save).not.toHaveBeenCalled();

    repo.find.mockResolvedValue([makeEvent({ endAtLocal: null })]);
    result = await service.transition(new Date('2026-01-15T13:01:00Z'));
    expect(result).toEqual({ completed: 1 });
    expect(repo.save.mock.calls[0][0].status).toBe('completed');
  });

  it('re-running transition() with the same now is a no-op the second time', async () => {
    const events = [makeEvent()];
    repo.find.mockImplementation(async ({ where }: { where: { status: string } }) =>
      events.filter((e) => e.status === where.status),
    );

    const now = new Date('2026-01-15T12:01:00Z');
    const first = await service.transition(now);
    expect(first).toEqual({ completed: 1 });

    const second = await service.transition(now);
    expect(second).toEqual({ completed: 0 });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledTimes(1);
  });

  it('never touches draft or cancelled events (excluded by the status filter)', async () => {
    // The repo query filters on status: 'published', so draft/cancelled rows
    // are never returned by `find` in the first place.
    repo.find.mockImplementation(async ({ where }: { where: { status: string } }) => {
      const events = [
        makeEvent({ id: 'draft-1', status: 'draft' }),
        makeEvent({ id: 'cancelled-1', status: 'cancelled' }),
      ];
      return events.filter((e) => e.status === where.status);
    });

    const result = await service.transition(new Date('2026-01-15T12:01:00Z'));
    expect(result).toEqual({ completed: 0 });
    expect(repo.save).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
