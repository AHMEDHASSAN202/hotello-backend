import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { EntityManager } from 'typeorm';
import { StayCodeService } from './stay-code.service';

const SECRET = 'test-hmac-secret';

describe('StayCodeService', () => {
  let service: StayCodeService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StayCodeService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'STAY_CODE_HMAC_SECRET') return SECRET;
              throw new Error(`unexpected key ${key}`);
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(StayCodeService);
  });

  describe('generate (13.1 AC3)', () => {
    it('always produces exactly six digits, zero-padded', () => {
      for (let i = 0; i < 200; i += 1) {
        expect(service.generate()).toMatch(/^\d{6}$/);
      }
    });

    it('is not constant across calls (CSPRNG, never sequential)', () => {
      const codes = new Set(
        Array.from({ length: 50 }, () => service.generate()),
      );
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('hash (13.1 AC3)', () => {
    it('is the deterministic HMAC-SHA256 hex of the code', () => {
      const expected = createHmac('sha256', SECRET)
        .update('123456')
        .digest('hex');
      expect(service.hash('123456')).toEqual(expected);
      expect(service.hash('123456')).toEqual(service.hash('123456'));
      expect(service.hash('123456')).toHaveLength(64);
    });

    it('different codes hash differently', () => {
      expect(service.hash('123456')).not.toEqual(service.hash('123457'));
    });
  });

  describe('issueUniqueCode (13.1 AC3)', () => {
    const managerWith = (findOne: jest.Mock): EntityManager =>
      ({
        getRepository: jest.fn(() => ({ findOne })),
      }) as unknown as EntityManager;

    it('retries until the code is unused among the hotel’s active stays', async () => {
      const findOne = jest
        .fn()
        .mockResolvedValueOnce({ id: 'stay-existing' })
        .mockResolvedValueOnce(null);
      const issued = await service.issueUniqueCode(
        managerWith(findOne),
        'hotel-1',
      );

      expect(findOne).toHaveBeenCalledTimes(2);
      expect(issued.code).toMatch(/^\d{6}$/);
      expect(issued.codeHash).toEqual(service.hash(issued.code));
      // Uniqueness is checked against ACTIVE stays of THIS hotel only.
      expect(findOne).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            hotelId: 'hotel-1',
            status: 'active',
          }),
        }),
      );
    });

    it('gives up after the retry cap instead of looping forever', async () => {
      const findOne = jest.fn().mockResolvedValue({ id: 'always-taken' });
      await expect(
        service.issueUniqueCode(managerWith(findOne), 'hotel-1'),
      ).rejects.toThrow(/unique stay code/i);
      expect(findOne).toHaveBeenCalledTimes(20);
    });
  });
});
