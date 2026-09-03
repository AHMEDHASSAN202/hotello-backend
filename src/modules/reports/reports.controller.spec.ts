import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { ReportPeriodDto } from './dto/report-period.dto';
import { ReportsBalancesService } from './reports-balances.service';
import { ReportsController } from './reports.controller';

const user = { id: 'user-1', hotelId: 'hotel-1' } as unknown as TenantUser;

describe('ReportsController (Story 22.4)', () => {
  let controller: ReportsController;
  let balances: { balances: jest.Mock; leakage: jest.Mock };

  beforeEach(async () => {
    balances = { balances: jest.fn(), leakage: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsBalancesService, useValue: balances }],
    }).compile();
    controller = moduleRef.get(ReportsController);
  });

  it('1. GET balances calls balances.balances(user.hotelId)', () => {
    controller.getBalances(user);

    expect(balances.balances).toHaveBeenCalledWith('hotel-1');
  });

  it('2. GET balances/leakage calls balances.leakage(user.hotelId, query) unchanged', () => {
    const query: ReportPeriodDto = { preset: 'last7' } as ReportPeriodDto;

    controller.getLeakage(user, query);

    expect(balances.leakage).toHaveBeenCalledWith('hotel-1', query);
  });
});
