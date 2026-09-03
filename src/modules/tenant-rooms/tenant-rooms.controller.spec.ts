import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { StaySettlementService } from '../stay-settlement/stay-settlement.service';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { RoomsPdfService } from './pdf/rooms-pdf.service';
import { TenantRoomsController } from './tenant-rooms.controller';
import { TenantRoomsService } from './tenant-rooms.service';
import { RoomsXlsxService } from './xlsx/rooms-xlsx.service';

const user = {
  id: 'user-1',
  hotelId: 'hotel-1',
  role: { permissions: ['stays.read'] },
} as unknown as TenantUser;

// Epic 22 final review, I2 — a Housekeeping-role actor: rooms.read +
// rooms.update, but NOT stays.read.
const housekeepingUser = {
  id: 'user-2',
  hotelId: 'hotel-1',
  role: { permissions: ['rooms.read', 'rooms.update'] },
} as unknown as TenantUser;

describe('TenantRoomsController (Story 22.4 AC4)', () => {
  let controller: TenantRoomsController;
  let roomsService: { list: jest.Mock };
  let staySettlement: { unsettledByStay: jest.Mock };

  beforeEach(async () => {
    roomsService = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
    staySettlement = { unsettledByStay: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantRoomsController],
      providers: [
        { provide: TenantRoomsService, useValue: roomsService },
        { provide: RoomsPdfService, useValue: {} },
        { provide: RoomsXlsxService, useValue: {} },
        { provide: StaySettlementService, useValue: staySettlement },
      ],
    }).compile();
    controller = moduleRef.get(TenantRoomsController);
  });

  it('fetches the balances map for a stays.read actor, then forwards it into roomsService.list', async () => {
    const balances = new Map([['stay-1', { total: 10, byKey: {}, oldestUnsettledAt: new Date() }]]);
    staySettlement.unsettledByStay.mockResolvedValue(balances);
    const query: ListRoomsQueryDto = {} as ListRoomsQueryDto;

    await controller.list(user, query);

    expect(staySettlement.unsettledByStay).toHaveBeenCalledWith('hotel-1');
    expect(roomsService.list).toHaveBeenCalledWith('hotel-1', query, true, balances);
  });

  it('Epic 22 final review, I2 — a stays.read-less actor (e.g. Housekeeping) never fetches balances at all', async () => {
    const query: ListRoomsQueryDto = {} as ListRoomsQueryDto;

    await controller.list(housekeepingUser, query);

    expect(staySettlement.unsettledByStay).not.toHaveBeenCalled();
    expect(roomsService.list).toHaveBeenCalledWith('hotel-1', query, false, undefined);
  });
});
