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
import {
  HotelInfoPhoto,
  HotelInfoSection,
  HotelInfoStructured,
} from './hotel-info.constants';

/**
 * Epic 17 — one directory entry, typed by `section` (spec note 1: one table,
 * don't over-normalize). Singleton sections (essentials/about) hold at most
 * one row per hotel; repeatable sections are soft-deactivated only. Names and
 * descriptions are 7-locale JSONB maps (ar+en required for names, EN fallback
 * via localizeField); section-specific fields live in `structured`.
 */
@Entity('hotel_info_entries')
@Index('IDX_hotel_info_entries_hotel_section', ['hotelId', 'section'])
export class HotelInfoEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  @ManyToOne(() => Hotel)
  @JoinColumn({ name: 'hotelId' })
  hotel: Hotel;

  @Column({ length: 20 })
  section: HotelInfoSection;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  names: TranslationMap;

  @Column({ type: 'jsonb', nullable: true })
  descriptions: TranslationMap | null;

  /** Typed per section: essentials wifi/phones, facility windows/location, … */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  structured: HotelInfoStructured;

  /** Uploaded photos (facility: max 1, about gallery: max 8). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  photos: HotelInfoPhoto[];

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
