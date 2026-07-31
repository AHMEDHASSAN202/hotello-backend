import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { generateTempPassword } from '../../common/utils/credentials';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import {
  NOTIFICATION_EVENTS,
  StaffInviteRequestedEvent,
  StaffWelcomeRequestedEvent,
  safeEmit,
} from '../notifications/notification-events';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantRole } from '../tenant-roles/tenant-role.entity';
import { TenantRolesService } from '../tenant-roles/tenant-roles.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { CreateStaffDirectDto } from './dto/create-staff-direct.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const BCRYPT_ROUNDS = 10;

/** Story 9.6 AC2 — one resend per user per 10 minutes. */
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

/** Story 9.8 AC4 — a manager may reset a given staff member 3× per hour. */
const RESET_LIMIT_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

/** Statuses that occupy a plan seat (Story 9.3 AC2, spec note #4). */
const SEAT_STATUSES = ['pending', 'active'] as const;

@Injectable()
export class TenantStaffService {
  private readonly logger = new Logger(TenantStaffService.name);

  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly dataSource: DataSource,
    private readonly rolesService: TenantRolesService,
    private readonly subscriptions: SubscriptionsService,
    private readonly tenantUsersService: TenantUsersService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Story 9.2 — hotel-scoped list with search, role/status filters, paging. */
  async list(actor: TenantUser, query: ListStaffQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.tenantUsersRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'role')
      .where('u.hotelId = :hotelId', { hotelId: actor.hotelId });

    if (query.search) {
      qb.andWhere('(u.name ILIKE :search OR u.email ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }
    if (query.roleId) qb.andWhere('u.roleId = :roleId', { roleId: query.roleId });
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });

    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data: rows.map((u) => this.toStaffItem(u)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Story 9.3 — invite a staff member. The seat guard runs inside a
   * transaction that pessimistically locks the hotel row, so two invites
   * racing the last seat cannot both pass (spec note #4). Creates the user as
   * `pending` with a setup token, then emails the invite (post-commit).
   */
  async invite(actor: TenantUser, dto: InviteStaffDto) {
    const email = dto.email.toLowerCase();

    const result = await this.dataSource.transaction(async (manager) => {
      const hotel = await manager.getRepository(Hotel).findOne({
        where: { id: actor.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hotel) {
        throw new NotFoundException({
          code: 'HOTEL_NOT_FOUND',
          message: 'Hotel not found',
        });
      }

      const role = await this.rolesService.findInHotel(
        actor.hotelId,
        dto.roleId,
      );
      if (role.isSystem) {
        // Story 9.3 AC1 — the Owner role is not selectable at invite time.
        throw new BadRequestException({
          code: 'OWNER_ROLE_NOT_ASSIGNABLE',
          message: 'The Owner role cannot be assigned to staff',
        });
      }

      const existing = await manager.getRepository(TenantUser).findOne({
        where: { hotelId: actor.hotelId, email },
      });
      if (existing) {
        // Story 9.3 AC1 — email unique across tenant users → 422.
        throw new UnprocessableEntityException({
          code: 'EMAIL_TAKEN',
          message: 'A staff member with this email already exists',
        });
      }

      const seatCount = await this.countSeats(manager, actor.hotelId);
      const limit = await this.staffLimit(actor.hotelId);
      if (limit !== null && seatCount >= limit) {
        // Story 9.3 AC2 — active + pending count has reached the plan limit.
        throw new ConflictException({
          code: 'STAFF_LIMIT_REACHED',
          message: `Your plan allows up to ${limit} staff member(s)`,
          limit,
        });
      }

      const usersRepo = manager.getRepository(TenantUser);
      const user = await usersRepo.save(
        usersRepo.create({
          hotelId: actor.hotelId,
          name: dto.name,
          email,
          roleId: role.id,
          status: 'pending',
          inviteSentAt: new Date(),
        }),
      );
      const token = await this.tenantUsersService.issueSetupToken(
        user,
        manager,
      );

      hotel.staffUsersCount = seatCount + 1;
      await manager.getRepository(Hotel).save(hotel);

      user.role = role;
      return { user, role, hotel, token };
    });

    await this.auditLogs.log({
      action: 'staff.invited',
      entityType: 'tenant_user',
      entityId: result.user.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        inviteeEmail: email,
        roleId: result.role.id,
      },
    });
    await this.emitInvite(result.user, result.role, result.hotel, result.token);

    return this.toStaffItem(result.user);
  }

  /** Story 9.4 — edit name and/or role, with owner and self-role guards. */
  async update(actor: TenantUser, id: string, dto: UpdateStaffDto) {
    const user = await this.findStaffInHotel(actor.hotelId, id);
    if (user.role.isSystem) {
      // Story 9.4 AC2 — the owner account is edited via My Profile, not here.
      throw new BadRequestException({
        code: 'CANNOT_EDIT_OWNER',
        message: 'The owner account cannot be edited here',
      });
    }

    const diff: Record<string, { from: unknown; to: unknown }> = {};

    if (dto.roleId && dto.roleId !== user.roleId) {
      if (user.id === actor.id) {
        // Story 9.4 AC3 — users cannot change their own role.
        throw new BadRequestException({
          code: 'CANNOT_CHANGE_OWN_ROLE',
          message: 'You cannot change your own role',
        });
      }
      const newRole = await this.rolesService.findInHotel(
        actor.hotelId,
        dto.roleId,
      );
      if (newRole.isSystem) {
        throw new BadRequestException({
          code: 'OWNER_ROLE_NOT_ASSIGNABLE',
          message: 'No one can be promoted to Owner',
        });
      }
      diff.roleId = { from: user.roleId, to: newRole.id };
      user.roleId = newRole.id;
      user.role = newRole;
    }

    if (dto.name && dto.name !== user.name) {
      diff.name = { from: user.name, to: dto.name };
      user.name = dto.name;
    }

    if (Object.keys(diff).length > 0) {
      await this.tenantUsersRepo.save(user);
      await this.auditLogs.log({
        action: 'staff.updated',
        entityType: 'tenant_user',
        entityId: user.id,
        actorId: actor.id,
        metadata: { actorType: 'tenant_user', hotelId: actor.hotelId, diff },
      });
    }

    return this.toStaffItem(user);
  }

  /**
   * Story 9.5 — disable access. Clears the refresh hash (kills live sessions,
   * same mechanism as 8.4 AC3; access tokens die per-request via the strategy)
   * and any outstanding setup token (AC3). No hard delete exists.
   */
  async disable(actor: TenantUser, id: string) {
    const user = await this.findStaffInHotel(actor.hotelId, id);
    if (user.role.isSystem) {
      throw new BadRequestException({
        code: 'CANNOT_DISABLE_OWNER',
        message: 'The owner account cannot be disabled',
      });
    }
    if (user.id === actor.id) {
      throw new BadRequestException({
        code: 'CANNOT_DISABLE_SELF',
        message: 'You cannot disable your own account',
      });
    }
    if (user.status === 'disabled') {
      throw new ConflictException({
        code: 'STAFF_ALREADY_DISABLED',
        message: 'This staff member is already disabled',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      const hotel = await manager.getRepository(Hotel).findOne({
        where: { id: actor.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      user.status = 'disabled';
      user.refreshTokenHash = null;
      user.setupTokenHash = null;
      user.setupTokenExpiresAt = null;
      await manager.getRepository(TenantUser).save(user);
      if (hotel) {
        hotel.staffUsersCount = await this.countSeats(manager, actor.hotelId);
        await manager.getRepository(Hotel).save(hotel);
      }
    });

    await this.auditLogs.log({
      action: 'staff.disabled',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: actor.id,
      metadata: { actorType: 'tenant_user', hotelId: actor.hotelId },
    });
    return this.toStaffItem(user);
  }

  /**
   * Story 9.5 AC4 — re-enable. Restores `active` for users who activated once,
   * `pending` for those who never did (the UI then offers Resend). Re-checks
   * the seat limit so a re-enable can't push usage past the plan.
   */
  async enable(actor: TenantUser, id: string) {
    const user = await this.findStaffInHotel(actor.hotelId, id);
    if (user.status !== 'disabled') {
      throw new ConflictException({
        code: 'STAFF_NOT_DISABLED',
        message: 'This staff member is not disabled',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      const hotel = await manager.getRepository(Hotel).findOne({
        where: { id: actor.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      const seatCount = await this.countSeats(manager, actor.hotelId);
      const limit = await this.staffLimit(actor.hotelId);
      if (limit !== null && seatCount >= limit) {
        throw new ConflictException({
          code: 'STAFF_LIMIT_REACHED',
          message: `Your plan allows up to ${limit} staff member(s)`,
          limit,
        });
      }
      user.status = user.passwordHash ? 'active' : 'pending';
      await manager.getRepository(TenantUser).save(user);
      if (hotel) {
        hotel.staffUsersCount = seatCount + 1;
        await manager.getRepository(Hotel).save(hotel);
      }
    });

    await this.auditLogs.log({
      action: 'staff.enabled',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: actor.id,
      metadata: { actorType: 'tenant_user', hotelId: actor.hotelId },
    });
    return this.toStaffItem(user);
  }

  /**
   * Story 9.6 — resend a pending invite with a fresh token (the prior link is
   * invalidated by the hash overwrite, Epic 05). Rate-limited per user.
   */
  async resendInvite(actor: TenantUser, id: string) {
    const user = await this.findStaffInHotel(actor.hotelId, id);
    if (user.status !== 'pending') {
      throw new ConflictException({
        code: 'RESEND_ONLY_PENDING',
        message: 'Only pending invitations can be resent',
      });
    }
    if (user.inviteSentAt) {
      const elapsed = Date.now() - user.inviteSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil(
          (RESEND_COOLDOWN_MS - elapsed) / 1000,
        );
        throw new HttpException(
          {
            code: 'INVITE_COOLDOWN',
            message: 'Please wait before resending this invitation',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const hotel = await this.hotelsRepo.findOne({
      where: { id: actor.hotelId },
    });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }

    user.inviteSentAt = new Date();
    const token = await this.tenantUsersService.issueSetupToken(user);

    await this.auditLogs.log({
      action: 'staff.invite_resent',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: actor.id,
      metadata: { actorType: 'tenant_user', hotelId: actor.hotelId },
    });
    await this.emitInvite(user, user.role, hotel, token);

    return this.toStaffItem(user);
  }

  /**
   * Story 9.7 — create a staff account directly with a username and a
   * temporary password (generated when not supplied). The account is `active`
   * with `mustChangePassword` set, and the plaintext password is returned to
   * the caller exactly once (never stored). Same seat guard as invites.
   */
  async createDirect(actor: TenantUser, dto: CreateStaffDirectDto) {
    const username = dto.username.toLowerCase();
    const email = dto.email?.toLowerCase() ?? null;
    const rawPassword = dto.password ?? generateTempPassword();

    const result = await this.dataSource.transaction(async (manager) => {
      const hotel = await manager.getRepository(Hotel).findOne({
        where: { id: actor.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hotel) {
        throw new NotFoundException({
          code: 'HOTEL_NOT_FOUND',
          message: 'Hotel not found',
        });
      }

      const role = await this.rolesService.findInHotel(
        actor.hotelId,
        dto.roleId,
      );
      if (role.isSystem) {
        throw new BadRequestException({
          code: 'OWNER_ROLE_NOT_ASSIGNABLE',
          message: 'The Owner role cannot be assigned to staff',
        });
      }

      const usersRepo = manager.getRepository(TenantUser);
      if (await usersRepo.findOne({ where: { hotelId: actor.hotelId, username } })) {
        // Story 9.7 AC2 — username unique within the hotel.
        throw new UnprocessableEntityException({
          code: 'USERNAME_TAKEN',
          message: 'That username is already taken in this hotel',
        });
      }
      if (email && (await usersRepo.findOne({ where: { hotelId: actor.hotelId, email } }))) {
        throw new UnprocessableEntityException({
          code: 'EMAIL_TAKEN',
          message: 'A staff member with this email already exists',
        });
      }

      const seatCount = await this.countSeats(manager, actor.hotelId);
      const limit = await this.staffLimit(actor.hotelId);
      if (limit !== null && seatCount >= limit) {
        throw new ConflictException({
          code: 'STAFF_LIMIT_REACHED',
          message: `Your plan allows up to ${limit} staff member(s)`,
          limit,
        });
      }

      const user = await usersRepo.save(
        usersRepo.create({
          hotelId: actor.hotelId,
          name: dto.name,
          username,
          email,
          roleId: role.id,
          status: 'active',
          passwordHash: await bcrypt.hash(rawPassword, BCRYPT_ROUNDS),
          mustChangePassword: true, // Story 9.7 AC4
        }),
      );

      hotel.staffUsersCount = seatCount + 1;
      await manager.getRepository(Hotel).save(hotel);

      user.role = role;
      return { user, role, hotel };
    });

    const welcomeEmailSent = !!(email && dto.sendWelcomeEmail);
    await this.auditLogs.log({
      action: 'staff.created_direct',
      entityType: 'tenant_user',
      entityId: result.user.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        username,
        roleId: result.role.id,
        welcomeEmailSent, // never the password (AC8)
      },
    });
    if (welcomeEmailSent) {
      await this.emitWelcome(result.user, result.hotel, email!);
    }

    // Story 9.7 AC5 — credentials returned once; never persisted or retrievable.
    return {
      staff: this.toStaffItem(result.user),
      credentials: {
        username,
        tempPassword: rawPassword,
        loginUrl: this.tenantUsersService.buildLoginLink(result.hotel.slug),
      },
    };
  }

  /**
   * Story 9.8 — manager-driven password reset. Issues a new temporary password
   * (returned once), forces a change on next login, kills every session and
   * invalidates outstanding tokens. Not allowed against the owner or oneself.
   */
  async resetPassword(actor: TenantUser, id: string) {
    const user = await this.findStaffInHotel(actor.hotelId, id);
    if (user.role.isSystem) {
      // The owner self-resets via email only (9.8 AC3).
      throw new BadRequestException({
        code: 'CANNOT_RESET_OWNER',
        message: 'The owner account cannot be reset here',
      });
    }
    if (user.id === actor.id) {
      throw new BadRequestException({
        code: 'CANNOT_RESET_SELF',
        message: 'Change your own password from My Profile',
      });
    }
    if (user.status !== 'active') {
      throw new ConflictException({
        code: 'STAFF_NOT_ACTIVE',
        message: 'Only active staff can have their password reset',
      });
    }

    // Story 9.8 AC4 — per-target rate limit, using the audit log as the ledger.
    const recentResets = await this.auditLogs.countSince(
      'staff.password_reset_by_manager',
      user.id,
      new Date(Date.now() - HOUR_MS),
    );
    if (recentResets >= RESET_LIMIT_PER_HOUR) {
      throw new HttpException(
        {
          code: 'PASSWORD_RESET_RATE_LIMIT',
          message: 'Too many password resets for this user — try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hotel = await this.hotelsRepo.findOne({ where: { id: actor.hotelId } });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }

    const rawPassword = generateTempPassword();
    user.passwordHash = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = true;
    // Story 9.8 AC2 — kill sessions + invalidate any outstanding tokens.
    user.refreshTokenHash = null;
    user.setupTokenHash = null;
    user.setupTokenExpiresAt = null;
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await this.tenantUsersRepo.save(user);

    await this.auditLogs.log({
      action: 'staff.password_reset_by_manager',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: actor.id,
      metadata: { actorType: 'tenant_user', hotelId: actor.hotelId },
    });

    return {
      credentials: {
        username: user.username,
        tempPassword: rawPassword,
        loginUrl: this.tenantUsersService.buildLoginLink(hotel.slug),
      },
    };
  }

  // --- helpers ---------------------------------------------------------------

  private async emitWelcome(user: TenantUser, hotel: Hotel, email: string) {
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.STAFF_WELCOME_REQUESTED,
      {
        hotelId: hotel.id,
        tenantUserId: user.id,
        userName: user.name,
        userEmail: email,
        username: user.username ?? '',
        hotelNameEn: hotel.nameEn,
        hotelNameAr: hotel.nameAr,
        slug: hotel.slug,
        language: hotel.defaultLanguage,
      } satisfies StaffWelcomeRequestedEvent,
      this.logger,
    );
  }

  private async findStaffInHotel(
    hotelId: string,
    id: string,
  ): Promise<TenantUser> {
    const user = await this.tenantUsersRepo.findOne({
      where: { id, hotelId },
      relations: ['role'],
    });
    if (!user) {
      // Story 9.2 AC3 — cross-tenant ids 404, never 403 (no existence leak).
      throw new NotFoundException({
        code: 'STAFF_NOT_FOUND',
        message: 'Staff member not found',
      });
    }
    return user;
  }

  /** Active + pending, non-owner (system role) users occupy a seat. */
  private async countSeats(
    manager: EntityManager,
    hotelId: string,
  ): Promise<number> {
    return manager
      .getRepository(TenantUser)
      .createQueryBuilder('u')
      .leftJoin('u.role', 'role')
      .where('u.hotelId = :hotelId', { hotelId })
      .andWhere('u.status IN (:...statuses)', { statuses: [...SEAT_STATUSES] })
      .andWhere('role.isSystem = false')
      .getCount();
  }

  /** The current plan's max_staff_users (`null` = unlimited). */
  private async staffLimit(hotelId: string): Promise<number | null> {
    const { current } = await this.subscriptions.getForHotel(hotelId);
    return current?.plan?.maxStaffUsers ?? null;
  }

  private async emitInvite(
    user: TenantUser,
    role: TenantRole,
    hotel: Hotel,
    token: { raw: string; expiresAt: Date },
  ) {
    // Invites only exist for email accounts (username-only staff get a temp
    // password instead). Reaching here without one is an upstream invariant
    // break — log loudly, never fail the business op (6.1 AC3).
    const userEmail = user.email;
    if (!userEmail) {
      this.logger.error(
        `Staff invite for user ${user.id} skipped — account has no email`,
      );
      return;
    }
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.STAFF_INVITE_REQUESTED,
      {
        hotelId: hotel.id,
        tenantUserId: user.id,
        userName: user.name,
        userEmail,
        roleNameEn: role.nameEn,
        roleNameAr: role.nameAr,
        hotelNameEn: hotel.nameEn,
        hotelNameAr: hotel.nameAr,
        slug: hotel.slug,
        // The invitee has no preference yet — use the hotel default (note #5).
        language: hotel.defaultLanguage,
        rawToken: token.raw,
        expiresAt: token.expiresAt,
      } satisfies StaffInviteRequestedEvent,
      this.logger,
    );
  }

  private toStaffItem(user: TenantUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      inviteSentAt: user.inviteSentAt,
      createdAt: user.createdAt,
      role: user.role
        ? {
            id: user.role.id,
            nameEn: user.role.nameEn,
            nameAr: user.role.nameAr,
            isSystem: user.role.isSystem,
          }
        : null,
    };
  }
}
