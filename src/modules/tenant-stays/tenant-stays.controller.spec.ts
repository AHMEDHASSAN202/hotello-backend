import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { StaySettlementService } from '../stay-settlement/stay-settlement.service';
import { ListStaysQueryDto } from './dto/list-stays-query.dto';
import { TenantStaysController } from './tenant-stays.controller';
import { TenantStaysService } from './tenant-stays.service';

const user = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

describe('TenantStaysController (Story 22.4 AC4)', () => {
  let controller: TenantStaysController;
  let staysService: { list: jest.Mock };
  let staySettlement: { unsettledByStay: jest.Mock };

  beforeEach(async () => {
    staysService = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
    staySettlement = { unsettledByStay: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantStaysController],
      providers: [
        { provide: TenantStaysService, useValue: staysService },
        { provide: StaySettlementService, useValue: staySettlement },
      ],
    }).compile();
    controller = moduleRef.get(TenantStaysController);
  });

  it('fetches the balances map unconditionally, then forwards it into staysService.list', async () => {
    const balances = new Map([['stay-1', { total: 10, byKey: {}, oldestUnsettledAt: new Date() }]]);
    staySettlement.unsettledByStay.mockResolvedValue(balances);
    const query: ListStaysQueryDto = { view: 'active' } as ListStaysQueryDto;

    await controller.list(user, query);

    expect(staySettlement.unsettledByStay).toHaveBeenCalledWith('hotel-1');
    expect(staysService.list).toHaveBeenCalledWith(user, query, balances);
  });
});
