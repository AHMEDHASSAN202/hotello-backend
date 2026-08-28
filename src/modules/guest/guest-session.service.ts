import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hotel } from '../hotels/hotel.entity';
import { StayCodeService } from '../tenant-stays/stay-code.service';
import { Stay } from '../tenant-stays/stay.entity';
import { GuestSessionDto } from './dto/guest-session.dto';
import { GuestRateLimitService } from './guest-rate-limit.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Floor for a token issued moments before auto-checkout closes the stay. */
const MIN_TTL_SECONDS = 60 * 60;

/** 13.5 AC1/AC6 — the minimal profile the Guest App boots from. */
export interface GuestProfile {
  guestName: string;
  roomNumber: string;
  hotelNameEn: string;
  hotelNameAr: string;
  slug: string;
  language: string;
  checkOutDate: string;
  /** 16.1 AC4 — the Guest App prices F&B menus from this, no extra calls. */
  stayType: string;
  /** Epic 16 — keys the client-persisted cart per stay (spec note 9). */
  stayId: string;
  /** Epic 20, 20.4 — the DND switch state; reconciled on boot/pull-refresh. */
  dndActive: boolean;
}

/**
 * Guest session entry (13.5). Wrong room/code combinations are ONE generic
 * 401 INVALID_CODE — the response never reveals whether a room exists, has a
 * stay, or the code was close (no occupancy enumeration, AC2). Multi-device
 * by design (AC5): sessions are stateless, the same code opens any number.
 */
@Injectable()
export class GuestSessionService {
  constructor(
    @InjectRepository(Stay) private readonly staysRepo: Repository<Stay>,
    @InjectRepository(Hotel) private readonly hotelsRepo: Repository<Hotel>,
    private readonly stayCodes: StayCodeService,
    private readonly rateLimit: GuestRateLimitService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createSession(
    slug: string,
    dto: GuestSessionDto,
    ip: string,
  ): Promise<{ accessToken: string; profile: GuestProfile }> {
    const hotel = await this.hotelsRepo.findOne({
      where: { slug: slug.toLowerCase() },
    });
    if (!hotel || hotel.status === 'inactive') {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    if (hotel.status === 'suspended') {
      // Guest-facing wording — never the internal suspension machinery (AC2).
      throw new ForbiddenException({
        code: 'HOTEL_UNAVAILABLE',
        message: 'This hotel is currently unavailable',
      });
    }

    const roomNumber = dto.roomNumber.trim().toUpperCase();
    this.rateLimit.assertAllowed(ip, hotel.id, roomNumber);

    // O(1) lookup by the deterministic code hash, then the room must match —
    // both failure shapes collapse into the same generic 401.
    const codeHash = this.stayCodes.hash(dto.code);
    const stay = await this.staysRepo.findOne({
      where: { hotelId: hotel.id, codeHash, status: 'active' },
      relations: ['room'],
    });
    if (!stay || stay.room.roomNumber !== roomNumber) {
      this.rateLimit.recordFailure(ip, hotel.id, roomNumber);
      throw new UnauthorizedException({
        code: 'INVALID_CODE',
        message: 'Invalid room or code',
      });
    }

    this.rateLimit.recordSuccess(ip, hotel.id, roomNumber);
    const accessToken = await this.signToken(stay);
    return { accessToken, profile: this.profileFor(stay, hotel) };
  }

  profileFor(stay: Stay, hotel?: Hotel): GuestProfile {
    const h = hotel ?? stay.hotel;
    return {
      guestName: stay.guestName,
      roomNumber: stay.room.roomNumber,
      hotelNameEn: h.nameEn,
      hotelNameAr: h.nameAr,
      slug: h.slug,
      language: stay.language,
      checkOutDate: stay.checkOutDate,
      stayType: stay.stayType,
      stayId: stay.id,
      dndActive: stay.room.housekeepingStatus === 'dnd',
    };
  }

  /**
   * AC4 — expiry = check-out date + 1 day buffer, capped by
   * GUEST_JWT_MAX_TTL_DAYS. The backstop only: the per-request stay check is
   * the authority, and extensions re-issue on the guest's next entry.
   */
  private async signToken(stay: Stay): Promise<string> {
    const maxDays = parseInt(
      this.config.get('GUEST_JWT_MAX_TTL_DAYS', '30'),
      10,
    );
    const untilBuffer =
      Date.parse(stay.checkOutDate) + 2 * DAY_MS - Date.now();
    const ttlSeconds = Math.max(
      MIN_TTL_SECONDS,
      Math.floor(Math.min(untilBuffer, maxDays * DAY_MS) / 1000),
    );
    return this.jwtService.signAsync(
      { sub: stay.id, hotelId: stay.hotelId, language: stay.language },
      {
        secret: this.config.getOrThrow('GUEST_JWT_SECRET'),
        audience: 'guest',
        expiresIn: ttlSeconds,
      },
    );
  }
}
