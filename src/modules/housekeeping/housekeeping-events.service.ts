import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HousekeepingEvent } from './housekeeping-event.entity';
import { CleaningType, HousekeepingEventType } from './housekeeping.constants';

export interface RecordHousekeepingEventInput {
  hotelId: string;
  roomId: string;
  eventType: HousekeepingEventType;
  cleaningType?: CleaningType | null;
  actorId?: string | null;
  assignedToId?: string | null;
}

/**
 * Epic 22 — the analytics-source write path for housekeeping history.
 * `audit_logs` stays the compliance trail; this table is the recurring-report
 * source (see the epic's Decisions section). MUST NEVER throw into the caller
 * — a lost analytics row is acceptable, a failed room clean is not (the
 * `onRoomVacated` discipline, applied here too).
 */
@Injectable()
export class HousekeepingEventsService {
  private readonly logger = new Logger(HousekeepingEventsService.name);

  constructor(
    @InjectRepository(HousekeepingEvent)
    private readonly repo: Repository<HousekeepingEvent>,
  ) {}

  async record(input: RecordHousekeepingEventInput): Promise<void> {
    try {
      await this.repo.insert({
        hotelId: input.hotelId,
        roomId: input.roomId,
        eventType: input.eventType,
        cleaningType: input.cleaningType ?? null,
        actorId: input.actorId ?? null,
        assignedToId: input.assignedToId ?? null,
        occurredAt: new Date(),
      });
    } catch (err) {
      this.logger.error(
        `housekeeping event record failed (${input.eventType}, room ${input.roomId}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
