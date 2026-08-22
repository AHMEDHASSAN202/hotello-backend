import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';

/**
 * Epic 16 — a hotel-defined delivery location (Pool, Beach A… — 16.3). "My
 * room" is implicit, never a row. `key` is IMMUTABLE once created (printed
 * QR stickers embed it — 16.3 AC4); renames touch display names only, and
 * deactivation hides from guests while QRs keep resolving to a graceful
 * fallback.
 */
@Entity('fnb_locations')
@Unique('UQ_fnb_locations_hotel_key', ['hotelId', 'key'])
export class FnbLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  /** Kebab slug of the EN name at creation; lives in printed QR URLs. */
  @Column({ length: 60 })
  key: string;

  /** ar + en required (16.3 AC1); guests see localizeField with EN fallback. */
  @Column({ type: 'jsonb' })
  names: TranslationMap;

  /** "Has numbered spots" toggle (16.3 AC1). */
  @Column({ default: false })
  hasSpots: boolean;

  /** Spot label (Umbrella / Table / شمسية), ar + en, when hasSpots. */
  @Column({ type: 'jsonb', nullable: true })
  spotLabel: TranslationMap | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
