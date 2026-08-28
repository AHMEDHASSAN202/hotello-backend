import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { Room } from '../tenant-rooms/room.entity';
import { Stay } from '../tenant-stays/stay.entity';
import { HousekeepingSchedulerService } from './housekeeping-scheduler.service';

const cairoHotel = (o: Record<string, unknown> = {}) => ({
  id: 'hotel-1',
  status: 'active',
  timezone: 'Africa/Cairo',
  dailyServiceTime: '09:00',
  ...o,
});

const makeRoom = (o: Record<string, unknown> = {}) => ({
  id: 'room-1',
  hotelId: 'hotel-1',
  roomNumber: '101',
  status: 'active',
  housekeepingStatus: 'clean',
  cleaningType: null,
  dndSetByStayId: null,
  housekeepingAssignedToId: null,
  lastDailyFlaggedOn: null,
  ...o,
});

// Cairo is UTC+3 in August (DST) — 07:00Z = 10:00 local (past 09:00),
// 05:00Z = 08:00 local (before it). Local date on both: 2026-08-29.
const PAST_HOUR = new Date('2026-08-29T07:00:00Z');
const BEFORE_HOUR = new Date('2026-08-29T05:00:00Z');
const LOCAL_DATE = '2026-08-29';

describe('HousekeepingSchedulerService', () => {
  let service: HousekeepingSchedulerService;
  let roomsRepo: { find: jest.Mock; save: jest.Mock };
  let staysRepo: { find: jest.Mock };
  let hotelsRepo: { find: jest.Mock };
  let auditLogs: { log: jest.Mock };

  beforeEach(async () => {
    roomsRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn(async (r) => r) };
    staysRepo = { find: jest.fn().mockResolvedValue([]) };
    hotelsRepo = { find: jest.fn().mockResolvedValue([cairoHotel()]) };
    auditLogs = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HousekeepingSchedulerService,
        { provide: getRepositoryToken(Room), useValue: roomsRepo },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
        { provide: getRepositoryToken(Hotel), useValue: hotelsRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = moduleRef.get(HousekeepingSchedulerService);
  });

  /** rooms.find is called twice per due hotel: dnd rooms, then candidates. */
  const mockRooms = (dndRooms: unknown[], candidates: unknown[]) => {
    roomsRepo.find
      .mockResolvedValueOnce(dndRooms)
      .mockResolvedValueOnce(candidates);
  };

  describe('daily flagging (20.1 AC4)', () => {
    it('does nothing before the hotel-local service hour', async () => {
      const res = await service.runDailyService(BEFORE_HOUR);
      expect(res).toEqual({ flagged: 0, released: 0 });
      expect(roomsRepo.find).not.toHaveBeenCalled();
    });

    it('flags occupied clean rooms daily, stamps the local date, system audit', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms([], [makeRoom()]);

      const res = await service.runDailyService(PAST_HOUR);

      expect(res).toEqual({ flagged: 1, released: 0 });
      const saved = roomsRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'daily',
        lastDailyFlaggedOn: LOCAL_DATE,
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.flagged',
          actorId: null,
          metadata: expect.objectContaining({
            actorType: 'system',
            cleaningType: 'daily',
            reason: 'daily_service_hour',
          }),
        }),
      );
    });

    it('is idempotent per room per local day (note 4)', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms([], [makeRoom({ lastDailyFlaggedOn: LOCAL_DATE })]);
      const res = await service.runDailyService(PAST_HOUR);
      expect(res).toEqual({ flagged: 0, released: 0 });
      expect(roomsRepo.save).not.toHaveBeenCalled();
    });

    it('only queries clean occupied rooms — flagged/in-progress/dnd are skipped by filter', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }, { roomId: 'room-2' }]);
      mockRooms([], []);
      await service.runDailyService(PAST_HOUR);
      expect(roomsRepo.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ housekeepingStatus: 'clean' }),
        }),
      );
    });

    it('vacant hotels do nothing (no occupied rooms → no flags)', async () => {
      staysRepo.find.mockResolvedValue([]);
      mockRooms([], []);
      const res = await service.runDailyService(PAST_HOUR);
      expect(res).toEqual({ flagged: 0, released: 0 });
      // only the dnd query ran; the candidates query was skipped
      expect(roomsRepo.find).toHaveBeenCalledTimes(1);
    });

    it('respects each hotel’s own timezone + service hour in one run', async () => {
      // 07:00Z: Cairo 10:00 (due, 09:00 setting); London 08:00 (not due).
      hotelsRepo.find.mockResolvedValue([
        cairoHotel(),
        cairoHotel({ id: 'hotel-2', timezone: 'Europe/London' }),
      ]);
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms([], [makeRoom()]);

      await service.runDailyService(PAST_HOUR);

      // Only Cairo was processed: one dnd query + one candidates query.
      expect(roomsRepo.find).toHaveBeenCalledTimes(2);
      expect(staysRepo.find).toHaveBeenCalledTimes(1);
      expect(staysRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hotelId: 'hotel-1' }),
        }),
      );
    });
  });

  describe('DND auto-clear (20.4 AC3)', () => {
    it('releases a DND set on a previous day and re-flags the occupied room daily', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms(
        [
          makeRoom({
            housekeepingStatus: 'dnd',
            dndSetByStayId: 'stay-1',
            lastDailyFlaggedOn: '2026-08-28',
          }),
        ],
        [],
      );

      const res = await service.runDailyService(PAST_HOUR);

      expect(res).toEqual({ flagged: 1, released: 1 });
      const saved = roomsRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'daily',
        dndSetByStayId: null,
        lastDailyFlaggedOn: LOCAL_DATE,
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'housekeeping.dnd_cleared',
          actorId: null,
          metadata: expect.objectContaining({
            actorType: 'system',
            reason: 'daily_service_hour',
            reFlagged: true,
          }),
        }),
      );
    });

    it('restores a parked flag instead of double-flagging (20.4 AC2)', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms(
        [
          makeRoom({
            housekeepingStatus: 'dnd',
            cleaningType: 'checkout',
            dndSetByStayId: 'stay-1',
            lastDailyFlaggedOn: '2026-08-28',
          }),
        ],
        [],
      );

      const res = await service.runDailyService(PAST_HOUR);

      expect(res).toEqual({ flagged: 0, released: 1 });
      expect(roomsRepo.save.mock.calls[0][0]).toMatchObject({
        housekeepingStatus: 'needs_cleaning',
        cleaningType: 'checkout',
      });
    });

    it('keeps a DND stamped today — the guest opted out of today’s service', async () => {
      staysRepo.find.mockResolvedValue([{ roomId: 'room-1' }]);
      mockRooms(
        [
          makeRoom({
            housekeepingStatus: 'dnd',
            dndSetByStayId: 'stay-1',
            lastDailyFlaggedOn: LOCAL_DATE,
          }),
        ],
        [],
      );

      const res = await service.runDailyService(PAST_HOUR);

      expect(res).toEqual({ flagged: 0, released: 0 });
      expect(roomsRepo.save).not.toHaveBeenCalled();
    });

    it('releases a vacant DND room to clean without flagging', async () => {
      staysRepo.find.mockResolvedValue([]); // no active stays
      mockRooms(
        [makeRoom({ housekeepingStatus: 'dnd', lastDailyFlaggedOn: '2026-08-28' })],
        [],
      );

      const res = await service.runDailyService(PAST_HOUR);

      expect(res).toEqual({ flagged: 0, released: 1 });
      expect(roomsRepo.save.mock.calls[0][0]).toMatchObject({
        housekeepingStatus: 'clean',
        cleaningType: null,
      });
    });
  });

  describe('handleTick', () => {
    it('skips a tick while the previous run is still going (re-entrancy)', async () => {
      let resolveFind!: (v: unknown) => void;
      hotelsRepo.find.mockReturnValue(new Promise((r) => (resolveFind = r)));

      const first = service.handleTick();
      await service.handleTick(); // overlapping tick
      resolveFind([]);
      await first;

      expect(hotelsRepo.find).toHaveBeenCalledTimes(1);
    });

    it('skips suspended hotels entirely', async () => {
      await service.runDailyService(PAST_HOUR);
      expect(hotelsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expect.anything() }),
        }),
      );
    });
  });
});
