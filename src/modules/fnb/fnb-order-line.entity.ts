import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../common/transformers/decimal.transformer';
import { TranslationMap } from '../requests/requests.constants';
import { FnbOrder } from './fnb-order.entity';

/**
 * Epic 16 — one line of an order. Names snapshot the guest language + ar +
 * en subsets (16.5 AC4); price/included come from resolvePrice at order time
 * and never change with later menu edits (16.2 AC6 snapshot rule).
 */
@Entity('fnb_order_lines')
@Index('IDX_fnb_order_lines_order', ['orderId'])
export class FnbOrderLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orderId: string;

  @ManyToOne(() => FnbOrder)
  @JoinColumn({ name: 'orderId' })
  order: FnbOrder;

  @Column('uuid')
  hotelId: string;

  /** Reference only — the snapshot fields below are what render. */
  @Column('uuid')
  itemId: string;

  @Column({ type: 'jsonb' })
  itemNames: TranslationMap;

  @Column({ type: 'varchar', length: 40, nullable: true })
  variantKey: string | null;

  @Column({ type: 'jsonb', nullable: true })
  variantLabel: TranslationMap | null;

  @Column({ type: 'jsonb', nullable: true })
  variantOptionNames: TranslationMap | null;

  @Column({ type: 'int' })
  quantity: number;

  /** 0 when included (✓Included renders from the flag, not the price). */
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  unitPrice: number;

  @Column()
  included: boolean;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  lineTotal: number;

  /** Guest note in the guest's language (16.2 AC5). */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Thumb rendition key at order time — order detail shows line photos. */
  @Column({ type: 'varchar', nullable: true })
  photoThumbKey: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}
