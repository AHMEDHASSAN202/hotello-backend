import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ListStaysQueryDto } from './dto/list-stays-query.dto';
import { TenantStaysController } from './tenant-stays.controller';
import { TenantStaysService } from './tenant-stays.service';

const user = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

/**
 * Epic 22 final review, I3 — the balance fetch/scoping this controller used
 * to own moved entirely into TenantStaysService.list() (see its spec), so
 * all that's left to prove here is a thin, argument-forwarding pass-through
 * with no StaySettlementService involvement at all.
 */
describe('TenantStaysController (Story 22.4 AC4; restructured Epic 22 final review I3)', () => {
  let controller: TenantStaysController;
  let staysService: { list: jest.Mock };

  beforeEach(async () => {
    staysService = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantStaysController],
      providers: [{ provide: TenantStaysService, useValue: staysService }],
    }).compile();
    controller = moduleRef.get(TenantStaysController);
  });

  it('forwards user/query straight through to staysService.list, with no balance fetch of its own', async () => {
    const query: ListStaysQueryDto = { view: 'active' } as ListStaysQueryDto;

    await controller.list(user, query);

    expect(staysService.list).toHaveBeenCalledWith(user, query);
  });
});
