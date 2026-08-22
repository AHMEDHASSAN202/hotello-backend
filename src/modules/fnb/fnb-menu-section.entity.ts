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
import { TranslationMap } from '../requests/requests.constants';
import { FnbMenu } from './fnb-menu.entity';

/** Epic 16 — a section within a menu (Starters, Mains, Drinks — 16.2 AC2). */
@Entity('fnb_menu_sections')
@Index('IDX_fnb_menu_sections_menu', ['menuId'])
export class FnbMenuSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Denormalized for isolation filters without a join. */
  @Column('uuid')
  hotelId: string;

  @Column('uuid')
  menuId: string;

  @ManyToOne(() => FnbMenu)
  @JoinColumn({ name: 'menuId' })
  menu: FnbMenu;

  @Column({ type: 'jsonb' })
  names: TranslationMap;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
