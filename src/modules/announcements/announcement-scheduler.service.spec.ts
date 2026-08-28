import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Announcement } from './announcement.entity';
import { AnnouncementSchedulerService } from './announcement-scheduler.service';

const makeAnnouncement = (o: Partial<Announcement> = {}): Announcement =>
  ({
    id: 'ann-1',
    hotelId: 'hotel-1',
    status: 'scheduled',
    publishAtLocal: '2026-01-15 12:00',
    activeUntilLocal: null,
    publishedAt: null,
    expiredAt: null,
    hotel: { id: 'hotel-1', timezone: 'Africa/Cairo' },
    ...o,
  }) as unknown as Announcement;

describe('AnnouncementSchedulerService (19.2 AC1, note 4)', () => {
  let service: AnnouncementSchedulerService;
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
        AnnouncementSchedulerService,
        { provide: getRepositoryToken(Announcement), useValue: repo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(AnnouncementSchedulerService);
  });

  it('is idempotent by construction — the query only selects scheduled/live rows', async () => {
    await service.transition(new Date('2026-01-15T10:00:00Z'));
    expect(repo.find).toHaveBeenCalledWith({
      where: { status: In(['scheduled', 'live']) },
      relations: ['hotel'],
    });
  });

  it('publishes scheduled rows once the hotel-local clock passes publishAtLocal', async () => {
    // Cairo is UTC+2 in winter: 10:00Z = 12:00 local — due; 09:59Z is not.
    repo.find.mockResolvedValue([makeAnnouncement()]);
    let result = await service.transition(new Date('2026-01-15T09:59:00Z'));
    expect(result).toEqual({ published: 0, expired: 0 });
    expect(repo.save).not.toHaveBeenCalled();

    repo.find.mockResolvedValue([makeAnnouncement()]);
    result = await service.transition(new Date('2026-01-15T10:00:00Z'));
    expect(result).toEqual({ published: 1, expired: 0 });
    const saved = repo.save.mock.calls[0][0];
    expect(saved.status).toBe('live');
    expect(saved.publishedAt).toEqual(new Date('2026-01-15T10:00:00Z'));
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'announcement.published',
        actorId: null,
        metadata: expect.objectContaining({ hotelId: 'hotel-1' }),
      }),
    );
  });

  it('judges each hotel by ITS local clock in the same tick', async () => {
    repo.find.mockResolvedValue([
      makeAnnouncement({ id: 'ann-cairo' }),
      makeAnnouncement({
        id: 'ann-moscow',
        hotel: { id: 'hotel-2', timezone: 'Europe/Moscow' },
      } as never),
    ]);
    // 09:30Z = 11:30 Cairo (not due) but 12:30 Moscow (due).
    const result = await service.transition(new Date('2026-01-15T09:30:00Z'));
    expect(result).toEqual({ published: 1, expired: 0 });
    expect(repo.save.mock.calls[0][0].id).toBe('ann-moscow');
  });

  it('expires live rows past activeUntilLocal and audits with a null actor', async () => {
    repo.find.mockResolvedValue([
      makeAnnouncement({
        id: 'ann-live',
        status: 'live',
        publishAtLocal: null,
        activeUntilLocal: '2026-01-15 12:00',
      }),
      makeAnnouncement({
        id: 'ann-open',
        status: 'live',
        publishAtLocal: null,
        activeUntilLocal: null,
      }),
    ]);
    const result = await service.transition(new Date('2026-01-15T10:00:00Z'));
    expect(result).toEqual({ published: 0, expired: 1 });
    const saved = repo.save.mock.calls[0][0];
    expect(saved.id).toBe('ann-live');
    expect(saved.status).toBe('expired');
    expect(saved.expiredAt).toEqual(new Date('2026-01-15T10:00:00Z'));
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'announcement.expired', actorId: null }),
    );
  });
});
