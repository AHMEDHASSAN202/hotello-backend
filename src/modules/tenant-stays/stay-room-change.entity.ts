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
import { Stay } from './stay.entity';

/**
 * Epic 22 — one row per room change during a stay, the dedicated
 * analytics-source table for the room-change count report metric (a
 * deliberate divergence from mining `audit_logs` jsonb — `audit_logs` stays
 * the compliance trail only). `occurredAt` is `timestamptz` on purpose — this
 * table has no naiveUtc landmine, unlike createdAt/updatedAt elsewhere
 * (`stay-time.ts`'s framing).
 */
@Entity('stay_room_changes')
@Index('IDX_stay_room_changes_hotel_occurred', ['hotelId', 'occurredAt'])
export class StayRoomChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column('uuid')
  stayId: string;

  @ManyToOne(() => Stay)
  @JoinColumn({ name: 'stayId' })
  stay: Stay;

  /** Null only if you decide a stay's very first room assignment should also
   *  emit a row (it should NOT — see Task B1c; this column is nullable purely
   *  because TypeORM requires it for symmetry with toRoomId, always populated
   *  in practice since changeRoom always has a prior room). */
  @Column({ type: 'uuid', nullable: true })
  fromRoomId: string | null;

  @ManyToOne(() => Room, { nullable: true })
  @JoinColumn({ name: 'fromRoomId' })
  fromRoom: Room | null;

  @Column('uuid')
  toRoomId: string;

  @ManyToOne(() => Room)
  @JoinColumn({ name: 'toRoomId' })
  toRoom: Room;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;
}
