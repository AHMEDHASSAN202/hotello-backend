import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TenantAccessService } from '../tenant-access/tenant-access.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantChangePasswordDto } from './dto/tenant-change-password.dto';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class TenantProfileService {
  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
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
