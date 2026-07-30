import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../roles/role.entity';

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Exclude()
  @Column()
  passwordHash: string;

  @Exclude()
  @Column({ type: 'text', nullable: true })
  refreshTokenHash: string | null;

  @Column({ default: true })
  isActive: boolean;

  /**
   * Preferred admin-dashboard UI language. Personal to each admin (not a
   * managed permission). Applied on login and synced from the language
   * switcher; a browser cookie covers the pre-login pages.
   */
  @Column({ type: 'varchar', length: 2, default: 'en' })
  preferredLanguage: 'en' | 'ar';

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column()
  roleId: string;

  @ManyToOne(() => Role, { eager: true })
  @JoinColumn({ name: 'roleId' })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
