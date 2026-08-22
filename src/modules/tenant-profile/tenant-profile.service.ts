import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantRole } from '../tenant-roles/tenant-role.entity';
import { Room } from '../tenant-rooms/room.entity';
import { isTenantHintKey } from '../tenant-users/tenant-hint-keys.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantChangePasswordDto } from './dto/tenant-change-password.dto';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class TenantProfileService {
  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @InjectRepository(TenantRole)
    private readonly tenantRolesRepo: Repository<TenantRole>,
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    private readonly access: TenantAccessService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Story 8.1/8.6/8.7 — the single shell-bootstrap call: who am I, which hotel,
   * and what's the live subscription/access state (trial banner, read-only,
   * enabled modules). The tenant user arrives with its `hotel` relation loaded
   * by the strategy.
   */
  async me(user: TenantUser) {
    const state = await this.access.getAccessState(user.hotelId);
    const hotel = user.hotel;
    // Epic 12, Story 12.4 AC3 — setup-step completion is derived from data the
    // hotel already has (no tracking tables). staffUsersCount includes the
    // owner, so "> 1" means a real staff member was added.
    const customRolesCount = await this.tenantRolesRepo.count({
      where: { hotelId: user.hotelId, isSystem: false },
    });
    const staffAdded = (hotel?.staffUsersCount ?? 0) > 1;
    const roleCreated = customRolesCount > 0;
    // Epic 11, Story 11.6 — rooms/QR setup steps join the checklist.
    // roomsAdded counts ANY room row regardless of status (a hotel that only
    // has an out_of_service room has still started); qrGenerated is set once
    // by the first QR PDF download (Task 9), never unset.
    const roomsAddedCount = await this.roomsRepo.count({
      where: { hotelId: user.hotelId },
    });
    const roomsAdded = roomsAddedCount > 0;
    const qrGenerated = hotel?.qrGeneratedAt != null;
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
          ? {
              id: user.role.id,
              nameEn: user.role.nameEn,
              nameAr: user.role.nameAr,
              isSystem: user.role.isSystem,
            }
          : null,
        permissions: user.role?.permissions ?? [],
        preferredLanguage: user.preferredLanguage,
        lastLoginAt: user.lastLoginAt,
        // Story 9.7 AC4 — the shell redirects to the forced change-password
        // screen while this is true.
        mustChangePassword: user.mustChangePassword,
        // Epic 12, Story 12.4 AC2 — HintCards render only for keys not here.
        dismissedHints: user.dismissedHints ?? [],
      },
      setup: {
        staffAdded,
        roleCreated,
        roomsAdded,
        qrGenerated,
        complete: staffAdded && roleCreated && roomsAdded && qrGenerated,
      },
      hotel: {
        slug: hotel?.slug,
        nameEn: hotel?.nameEn,
        nameAr: hotel?.nameAr,
        logoUrl: hotel?.logoPath ? `files/${hotel.logoPath}` : null,
        defaultLanguage: hotel?.defaultLanguage,
        status: state.hotelStatus,
      },
      subscription: {
        status: state.subscriptionStatus,
        trialEndsAt: state.trialEndsAt,
        trialDaysRemaining: state.trialDaysRemaining,
        readOnly: state.readOnly,
        enabledModules: state.enabledModules,
        planNameEn: state.planNameEn,
        planNameAr: state.planNameAr,
      },
    };
  }

  /**
   * Epic 12, Story 12.4 AC2 — mark a first-run hint as dismissed for this
   * user. Idempotent; keys outside the code-side allowlist are rejected so
   * the jsonb column cannot grow unbounded.
   */
  async dismissHint(user: TenantUser, key: string): Promise<void> {
    if (!isTenantHintKey(key)) {
      throw new BadRequestException({
        code: 'INVALID_HINT_KEY',
        message: 'Unknown hint key',
      });
    }
    const dismissed = user.dismissedHints ?? [];
    if (dismissed.includes(key)) return;
    user.dismissedHints = [...dismissed, key];
    await this.tenantUsersRepo.save(user);
  }

  /**
   * Epic 15 — remove a stored hint key. Exists for keys used as per-user
   * toggles (e.g. `requests.soundMuted`): dismiss = off, un-dismiss = on.
   * Same allowlist and idempotency rules as dismissHint.
   */
  async undismissHint(user: TenantUser, key: string): Promise<void> {
    if (!isTenantHintKey(key)) {
      throw new BadRequestException({
        code: 'INVALID_HINT_KEY',
        message: 'Unknown hint key',
      });
    }
    const dismissed = user.dismissedHints ?? [];
    if (!dismissed.includes(key)) return;
    user.dismissedHints = dismissed.filter((k) => k !== key);
    await this.tenantUsersRepo.save(user);
  }

  async updateProfile(user: TenantUser, dto: UpdateTenantProfileDto) {
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.preferredLanguage !== undefined) {
      user.preferredLanguage = dto.preferredLanguage;
    }
    const saved = await this.tenantUsersRepo.save(user);
    return this.me(saved);
  }

  /** Story 8.7 — current password required; success kills all other sessions. */
  async changePassword(user: TenantUser, dto: TenantChangePasswordDto) {
    const valid =
      !!user.passwordHash &&
      (await bcrypt.compare(dto.currentPassword, user.passwordHash));
    if (!valid) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      });
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    user.refreshTokenHash = null; // invalidate every other session
    await this.tenantUsersRepo.save(user);

    await this.auditLogs.log({
      action: 'tenant_user.password_changed',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId },
    });
  }
}
