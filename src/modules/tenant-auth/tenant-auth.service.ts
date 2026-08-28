import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import {
  NOTIFICATION_EVENTS,
  safeEmit,
  TenantPasswordResetRequestedEvent,
} from '../notifications/notification-events';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantPasswordResetConfirmDto } from './dto/tenant-password-reset-confirm.dto';
import { TenantPasswordResetRequestDto } from './dto/tenant-password-reset-request.dto';
import { TenantTokenService } from './tenant-token.service';

const BCRYPT_ROUNDS = 10;
const HOUR_MS = 60 * 60 * 1000;

/** Same generic response whether or not the email exists (Story 8.4 AC1). */
const RESET_REQUEST_ACK = {
  message: 'If that account exists, a password reset email has been sent',
};

/** Same opaque 401 for every credential failure — no account/hotel enumeration. */
const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid credentials',
};

/** A suspended hotel is fully locked (Story 8.1 AC4) — a distinct, clear signal. */
const HOTEL_SUSPENDED = {
  code: 'HOTEL_SUSPENDED',
  message: 'This hotel is currently unavailable',
};

/**
 * Story 8.3 AC1 — an identifier is an email when it contains `@`, otherwise a
 * username. Emails are matched case-insensitively; usernames as entered (Epic 09
 * owns username normalization). Returns the `where` fragment scoped to the hotel.
 */
function identifierWhere(hotelId: string, identifier: string) {
  const value = identifier.trim();
  return value.includes('@')
    ? { hotelId, email: value.toLowerCase() }
    : { hotelId, username: value };
}

@Injectable()
export class TenantAuthService {
  private readonly logger = new Logger(TenantAuthService.name);

  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tokens: TenantTokenService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Story 8.3 — login scoped to the resolved tenant, by email OR username. The
   * same identifier at another hotel is a different account; credentials never
   * cross tenants.
   */
  async login(dto: TenantLoginDto) {
    const hotel = await this.hotelsRepo.findOne({
      where: { slug: dto.slug.toLowerCase() },
    });
    // Unknown slug is indistinguishable from a bad password (no enumeration).
    if (!hotel) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (hotel.status === 'suspended') {
      throw new ForbiddenException(HOTEL_SUSPENDED);
    }

    const user = await this.tenantUsersRepo.findOne({
      where: identifierWhere(hotel.id, dto.identifier),
      relations: ['role'],
    });
    // Unknown user, no password set (pending), disabled, or wrong password all
    // yield the same 401.
    if (
      !user ||
      user.status !== 'active' ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    user.lastLoginAt = new Date();
    const tokens = await this.tokens.issueTokens(user); // persists lastLoginAt + rotated hash
    await this.auditLogs.log({
      action: 'tenant_user.login',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: hotel.id },
    });

    return {
      ...tokens,
      user: this.tokens.publicUser(user),
      hotel: { slug: hotel.slug },
    };
  }

  /** Story 8.5 — rotate the refresh token; a rotated-out or forged token is rejected. */
  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow('TENANT_JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const user = await this.tenantUsersRepo.findOne({
      where: { id: payload.sub },
      relations: ['hotel'],
    });
    if (
      !user ||
      !user.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, user.refreshTokenHash))
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.hotel?.status === 'suspended') {
      throw new ForbiddenException(HOTEL_SUSPENDED);
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.tokens.issueTokens(user);
  }

  /** Story 8.5 AC3 — explicit logout kills the session (clears the stored hash). */
  async logout(userId: string): Promise<void> {
    await this.tenantUsersRepo.update(
      { id: userId },
      { refreshTokenHash: null },
    );
    await this.auditLogs.log({
      action: 'tenant_user.logout',
      entityType: 'tenant_user',
      entityId: userId,
      actorId: userId,
      metadata: { actorType: 'tenant_user' },
    });
  }

  /**
   * Story 8.4 AC1 — "forgot password". The response is identical whether or not
   * the account exists (no enumeration). Suspended hotels and non-active users
   * are silently accepted with no email sent (AC4). A new request overwrites any
   * prior reset token, invalidating it (AC2).
   */
  async requestPasswordReset(dto: TenantPasswordResetRequestDto) {
    const identifier = dto.identifier.trim();
    // Username-shaped input can never self-reset (no email to send to) — silent
    // success, no email, no account-type leak (Story 8.4 AC5).
    if (!identifier.includes('@')) return RESET_REQUEST_ACK;

    const hotel = await this.hotelsRepo.findOne({
      where: { slug: dto.slug.toLowerCase() },
    });
    // Silent accept for unknown/suspended hotel — no state leak (AC4).
    if (!hotel || hotel.status === 'suspended') return RESET_REQUEST_ACK;

    const user = await this.tenantUsersRepo.findOne({
      where: { hotelId: hotel.id, email: identifier.toLowerCase() },
    });
    // No email on the account (username-only) → can't self-reset (AC5).
    if (!user || user.status !== 'active' || !user.email) {
      return RESET_REQUEST_ACK;
    }

    const raw = randomBytes(32).toString('base64url');
    const ttlHours = parseInt(this.config.get('RESET_TOKEN_TTL_HOURS', '2'), 10);
    const expiresAt = new Date(Date.now() + ttlHours * HOUR_MS);
    user.resetTokenHash = this.hashToken(raw);
    user.resetTokenExpiresAt = expiresAt;
    await this.tenantUsersRepo.save(user);

    await this.auditLogs.log({
      action: 'tenant_user.password_reset_requested',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: hotel.id },
    });

    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.TENANT_PASSWORD_RESET_REQUESTED,
      {
        hotelId: hotel.id,
        tenantUserId: user.id,
        userName: user.name,
        userEmail: user.email,
        hotelNameEn: hotel.nameEn,
        hotelNameAr: hotel.nameAr,
        slug: hotel.slug,
        language: user.preferredLanguage ?? hotel.defaultLanguage,
        rawToken: raw,
        expiresAt,
      } satisfies TenantPasswordResetRequestedEvent,
      this.logger,
    );

    return RESET_REQUEST_ACK;
  }

  /**
   * Story 8.4 AC3 — consume a valid reset token: set the new password, clear the
   * token (single-use), and invalidate every existing session by clearing the
   * stored refresh hash. Same generic 400 for unknown/expired tokens.
   */
  async confirmPasswordReset(dto: TenantPasswordResetConfirmDto) {
    const user = await this.tenantUsersRepo.findOne({
      where: { resetTokenHash: this.hashToken(dto.token) },
      relations: ['hotel'],
    });
    if (
      !user ||
      !user.resetTokenExpiresAt ||
      user.resetTokenExpiresAt < new Date() ||
      // A user disabled after requesting the reset can no longer consume it.
      user.status !== 'active'
    ) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    if (user.hotel?.status === 'suspended') {
      throw new ForbiddenException(HOTEL_SUSPENDED);
    }

    user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    user.refreshTokenHash = null; // kill all existing sessions (AC3)
    // Story 9.7 AC4 — a self-chosen password also ends the temporary-password
    // state, so a manager-reset user who takes the email link instead of the
    // forced screen isn't left stuck on it.
    user.mustChangePassword = false;
    await this.tenantUsersRepo.save(user);

    await this.auditLogs.log({
      action: 'tenant_user.password_reset',
      entityType: 'tenant_user',
      entityId: user.id,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId },
    });

    return { message: 'Password updated — you can now sign in' };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
