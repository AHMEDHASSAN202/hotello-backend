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
import { ColumnNumericTransformer } from '../../common/transformers/decimal.transformer';
import { TranslationMap } from '../requests/requests.constants';
import { StayType } from '../tenant-stays/stays.constants';
import { FnbPhotoKeys, FnbVariant } from './fnb.constants';
import { FnbMenuSection } from './fnb-menu-section.entity';

/**
 * Epic 16 — a menu item. Pricing mode (16.2 AC3): `includedFor` null =
 * inherit the menu default; [] = always paid (override); non-empty =
 * included for those stay types. One optional variant group (AC4). Photos
 * are storage keys, two renditions (spec note 6). Soft-deactivate only —
 * orders snapshot everything they show (AC6).
 */
@Entity('fnb_items')
@Index('IDX_fnb_items_section', ['sectionId'])
@Index('IDX_fnb_items_hotel', ['hotelId'])
export class FnbItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hotelId: string;

  /** Denormalized — availability checks resolve the menu without a 2nd hop. */
  @Column('uuid')
  menuId: string;

  @Column('uuid')
  sectionId: string;

  @ManyToOne(() => FnbMenuSection)
  @JoinColumn({ name: 'sectionId' })
  section: FnbMenuSection;

  @Column({ type: 'jsonb' })
  names: TranslationMap;

  @Column({ type: 'jsonb', nullable: true })
  descriptions: TranslationMap | null;

  @Column({ type: 'jsonb', nullable: true })
  photoKeys: FnbPhotoKeys | null;

  /** Base price in the hotel currency; variant options carry their own. */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  price: number;

  @Column({ type: 'jsonb', nullable: true })
  includedFor: StayType[] | null;

  @Column({ type: 'jsonb', nullable: true })
  variant: FnbVariant | null;

  /** 16.2 AC5 — per-item toggle for guest notes at order time. */
  @Column({ default: true })
  allowNotes: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
