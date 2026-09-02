import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { Room } from '../tenant-rooms/room.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CleaningType, HousekeepingEventType } from './housekeeping.constants';

/**
 * Epic 22 — one row per housekeeping state transition, the dedicated
 * analytics-source table for historical housekeeping metrics and per-attendant
 * workload reporting (a deliberate divergence from mining `audit_logs` jsonb —
 * `audit_logs` stays the compliance trail only; this is a daily-use recurring
 * report source). Written alongside the existing current-state-only
 * `rooms.housekeepingStatus` model, never replacing it.
 *
 * `occurredAt` is `timestamptz` on purpose — this table has no naiveUtc
 * landmine, unlike createdAt/updatedAt elsewhere (`stay-time.ts`'s framing).
 * No `createdAt`/`updatedAt` columns — `occurredAt` is the only timestamp, it
 * IS the record's meaning.
 */
@Entity('housekeeping_events')
@Index('IDX_housekeeping_events_hotel_occurred', ['hotelId', 'occurredAt'])
export class HousekeepingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  roomId: string;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'roomId' })
  room: Room;

  /** 'flagged' | 'started' | 'completed' | 'interrupted' | 'cleared' | 'dnd_set' | 'dnd_cleared' */
  @Column({ type: 'varchar', length: 16 })
  eventType: HousekeepingEventType;

  /** Set on 'flagged'/'completed' only; null otherwise. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  cleaningType: CleaningType | null;

  /** Null = system-originated (auto-vacate, daily scheduler tick). */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: TenantUser | null;

  /** The room's assignee at the time of this event (per-attendant workload reporting). */
  @Column({ type: 'uuid', nullable: true })
  assignedToId: string | null;

  @ManyToOne(() => TenantUser, { nullable: true })
  @JoinColumn({ name: 'assignedToId' })
  assignedTo: TenantUser | null;

  /** timestamptz on purpose — this table has no naiveUtc landmine, unlike createdAt/updatedAt elsewhere. */
  @Column({ type: 'timestamptz' })
  occurredAt: Date;
}
