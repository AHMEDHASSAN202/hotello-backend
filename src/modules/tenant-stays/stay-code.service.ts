import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt } from 'crypto';
import { EntityManager } from 'typeorm';
import { Stay } from './stay.entity';
import { STAY_CODE_LENGTH } from './stays.constants';

/**
 * With ~1M possible codes, 20 tries only exhaust when a hotel holds an
 * absurd number of active stays — treated as an internal error, not a 4xx.
 */
const MAX_GENERATION_ATTEMPTS = 20;

/**
 * Stay-code generation and hashing (13.1 AC3). Codes are 6 CSPRNG digits,
 * stored ONLY as a deterministic HMAC-SHA256 with a server secret: unlike
 * bcrypt, the same code always maps to the same hash, so the partial unique
 * index enforces per-hotel uniqueness and guest login is one indexed lookup —
 * while a leaked database still reveals no codes without the env secret.
 */
@Injectable()
export class StayCodeService {
  constructor(private readonly config: ConfigService) {}

  generate(): string {
    return randomInt(0, 10 ** STAY_CODE_LENGTH)
      .toString()
      .padStart(STAY_CODE_LENGTH, '0');
  }

  hash(code: string): string {
    const secret = this.config.getOrThrow<string>('STAY_CODE_HMAC_SECRET');
    return createHmac('sha256', secret).update(code).digest('hex');
  }

  /**
   * Mint a code unused among the hotel's ACTIVE stays (checked-out stays may
   * repeat codes — uniqueness only matters where login can hit). Runs on the
   * caller's transaction manager so the check and the insert share the lock
   * window; the partial unique index backs the residual race.
   */
  async issueUniqueCode(
    manager: EntityManager,
    hotelId: string,
  ): Promise<{ code: string; codeHash: string }> {
    const staysRepo = manager.getRepository(Stay);
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const code = this.generate();
      const codeHash = this.hash(code);
      const clash = await staysRepo.findOne({
        where: { hotelId, codeHash, status: 'active' },
        select: ['id'],
      });
      if (!clash) return { code, codeHash };
    }
    throw new InternalServerErrorException(
      'Could not generate a unique stay code',
    );
  }
}
