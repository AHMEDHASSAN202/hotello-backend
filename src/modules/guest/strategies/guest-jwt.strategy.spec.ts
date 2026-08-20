import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Stay } from '../../tenant-stays/stay.entity';
import { GuestJwtStrategy } from './guest-jwt.strategy';

describe('GuestJwtStrategy (13.5 AC4)', () => {
  let strategy: GuestJwtStrategy;
  let staysRepo: { findOne: jest.Mock };

  const validStay = () => ({
    id: 'stay-1',
    status: 'active',
    hotel: { status: 'active' },
    room: { roomNumber: '101' },
  });

  beforeEach(async () => {
    staysRepo = { findOne: jest.fn().mockResolvedValue(validStay()) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestJwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn(() => 'guest-secret') },
        },
        { provide: getRepositoryToken(Stay), useValue: staysRepo },
      ],
    }).compile();
    strategy = moduleRef.get(GuestJwtStrategy);
  });

  it('reloads the stay per request and returns it as the principal', async () => {
    const stay = await strategy.validate({ sub: 'stay-1' });
    expect(stay.id).toEqual('stay-1');
    expect(staysRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stay-1' },
        relations: ['hotel', 'room'],
      }),
    );
  });

  it('a checked-out stay is a generic 401 — checkout kills every device', async () => {
    staysRepo.findOne.mockResolvedValue({
      ...validStay(),
      status: 'checked_out',
    });
    await expect(strategy.validate({ sub: 'stay-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('a suspended (or inactive) hotel kills guest sessions the same way', async () => {
    staysRepo.findOne.mockResolvedValue({
      ...validStay(),
      hotel: { status: 'suspended' },
    });
    await expect(strategy.validate({ sub: 'stay-1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('an unknown stay id is the same generic 401', async () => {
    staysRepo.findOne.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'ghost' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
