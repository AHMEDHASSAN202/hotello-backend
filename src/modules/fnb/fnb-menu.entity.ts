import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { StayType } from '../tenant-stays/stays.constants';
import { FnbWindow } from './fnb.constants';

/**
 * Epic 16 — a hotel menu (In-Room Dining, Pool Bar…). Names/descriptions are
 * 7-locale JSONB maps (ar+en required, EN fallback via localizeField — the
 * Epic 15 pattern). Soft-deactivate only; existing orders hold snapshots so
 * menu edits never touch history (16.2 AC6).
 */
@Entity('fnb_menus')
@Index('IDX_fnb_menus_hotel', ['hotelId'])
export class FnbMenu {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column({ type: 'jsonb' })
  names: TranslationMap;

  @Column({ type: 'jsonb', nullable: true })
  descriptions: TranslationMap | null;

  /** Hotel-local wall-clock windows; [] = always available (16.2 AC1). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  windows: FnbWindow[];

  /**
   * Menu-level pricing default (16.2 AC3): stay types whose guests get items
   * included unless the item overrides. [] = everything paid by default.
   */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  defaultIncludedFor: StayType[];

  /** Prep-time SLA target in minutes (16.2 AC1) — feeds order dueAt. */
  @Column({ type: 'int', default: 30 })
  prepSlaMinutes: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
