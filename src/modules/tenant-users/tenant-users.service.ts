import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import {
  NOTIFICATION_EVENTS,
  OwnerSetupLinkRequestedEvent,
  safeEmit,
} from '../notifications/notification-events';
import { TenantTokenService } from '../tenant-auth/tenant-token.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { TenantUser } from './tenant-user.entity';

const BCRYPT_ROUNDS = 10;
const HOUR_MS = 60 * 60 * 1000;

export interface IssuedToken {
  raw: string;
  expiresAt: Date;
}

@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
    private readonly events: EventEmitter2,
    private readonly tenantTokens: TenantTokenService,
  ) {}

  /**
   * Story 5.6 AC3 — mints a one-time setup token. Only sha256(raw) is stored;
   * the raw value is returned exactly once to the caller. Overwriting the
   * hash implicitly invalidates any previously issued link.
   */
  async issueSetupToken(
    user: TenantUser,
    manager?: EntityManager,
  ): Promise<IssuedToken> {
    const raw = randomBytes(32).toString('base64url');
    const ttlHours = parseInt(
      this.config.get('SETUP_TOKEN_TTL_HOURS', '72'),
      10,
    );
    user.setupTokenHash = this.hash(raw);
    user.setupTokenExpiresAt = new Date(Date.now() + ttlHours * HOUR_MS);
    const repo = manager
      ? manager.getRepository(TenantUser)
      : this.tenantUsersRepo;
    await repo.save(user);
    return { raw, expiresAt: user.setupTokenExpiresAt };
  }

  /** Story 5.6 AC4 — new link for the hotel's owner; prior link dies. */
  async regenerateSetupLink(
    hotelId: string,
    actor: Admin,
    opts: { resendOfId?: string } = {},
  ) {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundException('Hotel not found');
    const owner = await this.tenantUsersRepo.findOne({
      where: { hotelId, role: { isSystem: true } },
      relations: ['role'],
    });
    if (!owner) throw new NotFoundException('Hotel has no owner account');

    const { raw, expiresAt } = await this.issueSetupToken(owner);
    await this.auditLogs.log({
      action: 'hotel.owner_link_regenerated',
      entityType: 'hotel',
      entityId: hotelId,
      actorId: actor.id,
      metadata: { ownerId: owner.id, ownerEmail: owner.email },
    });

    // Story 6.4 AC1 — regeneration also emails the (new) link automatically.
    // Awaited so the outbox row exists before we return (the resend flow
    // looks it up immediately after this call).
    await safeEmit(
      this.events,
      NOTIFICATION_EVENTS.OWNER_SETUP_LINK_REQUESTED,
      {
        hotelId: hotel.id,
        ownerId: owner.id,
        ownerName: owner.name,
        ownerEmail: owner.email,
        hotelNameEn: hotel.nameEn,
        hotelNameAr: hotel.nameAr,
        slug: hotel.slug,
        language: hotel.defaultLanguage,
        rawToken: raw,
        expiresAt,
        resendOfId: opts.resendOfId,
      } satisfies OwnerSetupLinkRequestedEvent,
      this.logger,
    );

    return { setupLink: this.buildSetupLink(hotel.slug, raw), expiresAt };
  }

  /**
   * Story 5.6 AC3 / 8.2 — public, rate-limited. Same 400 for unknown and
   * expired tokens (no probing which links exist). Single-use: token fields are
   * cleared on success. On success the account activates and is auto-logged-in
   * (Story 8.2 AC3): tenant tokens are issued and returned.
   */
  async setup(dto: SetupAccountDto) {
    const user = await this.tenantUsersRepo.findOne({
      where: { setupTokenHash: this.hash(dto.token) },
      relations: ['hotel', 'role'],
    });
    if (
      !user ||
      !user.setupTokenExpiresAt ||
      user.setupTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired setup link');
    }
    if (user.hotel?.status === 'suspended') {
      // Story 5.5 AC3 — a suspended hotel is fully locked, including setup.
      throw new ForbiddenException('This hotel is currently unavailable');
    }
    if (user.status === 'disabled') {
      // A disabled account must not re-activate itself via a leftover link
      // (same generic 400 as an invalid token — no state leak).
      throw new BadRequestException('Invalid or expired setup link');
    }

    user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    user.status = 'active';
    user.setupTokenHash = null;
    user.setupTokenExpiresAt = null;
    user.lastLoginAt = new Date();
    await this.tenantUsersRepo.save(user);

    const tokens = await this.tenantTokens.issueTokens(user);
    return {
      message: 'Password set — you are now signed in',
      ...tokens,
      user: this.tenantTokens.publicUser(user),
      hotel: { slug: user.hotel.slug },
    };
  }

  /**
   * Story 8.2 AC1 — data for the setup page to show the owner's name and hotel
   * read-only before they submit. Same generic 400 as setup for any invalid or
   * expired token (no enumeration).
   */
  async setupPreview(token: string) {
    const user = await this.tenantUsersRepo.findOne({
      where: { setupTokenHash: this.hash(token) },
      relations: ['hotel'],
    });
    if (
      !user ||
      !user.setupTokenExpiresAt ||
      user.setupTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired setup link');
    }
    if (user.hotel?.status === 'suspended') {
      // Same lock as setup() — a suspended hotel leaks nothing, not even the
      // owner's name (Story 5.5 AC3 / 8.1 AC4).
      throw new ForbiddenException('This hotel is currently unavailable');
    }
    return {
      name: user.name,
      email: user.email,
      hotelNameEn: user.hotel?.nameEn,
      hotelNameAr: user.hotel?.nameAr,
    };
  }

  buildSetupLink(slug: string, rawToken: string): string {
    const domain = this.config.get('TENANT_BASE_DOMAIN', 'gxp.example');
    return `https://${slug}.${domain}/setup?token=${rawToken}`;
  }

  buildResetLink(slug: string, rawToken: string): string {
    const domain = this.config.get('TENANT_BASE_DOMAIN', 'gxp.example');
    return `https://${slug}.${domain}/reset-password?token=${rawToken}`;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
