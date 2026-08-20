import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { Stay } from '../../tenant-stays/stay.entity';

/**
 * Third auth universe (Epic 13, 13.5): guest tokens carry only `sub` (the
 * stay id) plus the `guest` audience, and verify with their own secret — an
 * admin or tenant token can never pass here, nor vice versa.
 *
 * 13.5 AC4 — session validity IS stay validity: the stay (with hotel) is
 * reloaded on every request, so checkout (manual or automatic) and hotel
 * suspension kill every device on its next request without server-side
 * session storage. Token expiry (checkout + buffer) is only the backstop.
 * The generic 401 never distinguishes "expired token" from "dead stay".
 */
@Injectable()
export class GuestJwtStrategy extends PassportStrategy(Strategy, 'guest-jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(Stay)
    private readonly staysRepo: Repository<Stay>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('GUEST_JWT_SECRET'),
      audience: 'guest',
    });
  }

  async validate(payload: { sub: string }): Promise<Stay> {
    const stay = await this.staysRepo.findOne({
      where: { id: payload.sub },
      relations: ['hotel', 'room'],
    });
    if (!stay || stay.status !== 'active' || stay.hotel.status !== 'active') {
      throw new UnauthorizedException();
    }
    return stay;
  }
}
