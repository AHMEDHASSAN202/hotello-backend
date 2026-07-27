import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
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
  constructor(
    @InjectRepository(TenantUser)
    private readonly tenantUsersRepo: Repository<TenantUser>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
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
  async regenerateSetupLink(hotelId: string, actor: Admin) {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundException('Hotel not found');
    const owner = await this.tenantUsersRepo.findOne({
      where: { hotelId, role: 'owner' },
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
    return { setupLink: this.buildSetupLink(hotel.slug, raw), expiresAt };
  }

  /**
   * Story 5.6 AC3 — public, rate-limited. Same 400 for unknown and expired
   * tokens (no probing which links exist). Single-use: token fields are
   * cleared on success.
   */
  async setup(dto: SetupAccountDto): Promise<{ message: string }> {
    const user = await this.tenantUsersRepo.findOne({
      where: { setupTokenHash: this.hash(dto.token) },
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
      // Story 5.5 AC3 — a suspended hotel is fully locked, including setup.
      throw new ForbiddenException('This hotel is currently unavailable');
    }

    user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    user.status = 'active';
    user.setupTokenHash = null;
    user.setupTokenExpiresAt = null;
    await this.tenantUsersRepo.save(user);
    return { message: 'Password set — you can now sign in' };
  }

  buildSetupLink(slug: string, rawToken: string): string {
    const domain = this.config.get('TENANT_BASE_DOMAIN', 'gxp.example');
    return `https://${slug}.${domain}/setup?token=${rawToken}`;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
