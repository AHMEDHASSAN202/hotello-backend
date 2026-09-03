import { Test } from '@nestjs/testing';
import { TenantUser } from '../tenant-users/tenant-user.entity';
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

/**
 * Epic 22 final review, I2 + I3 — the balance fetch/scoping this controller
 * used to own moved entirely into TenantRoomsService.list() (see its spec),
 * so all this controller has left to prove is that it derives
 * `includeOccupancy` (== `canReadStays(user)`) correctly and passes it
 * straight through, with no StaySettlementService involvement at all.
 */
describe('TenantRoomsController (Story 22.4 AC4; restructured Epic 22 final review I2/I3)', () => {
  let controller: TenantRoomsController;
  let roomsService: { list: jest.Mock };

  beforeEach(async () => {
    roomsService = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantRoomsController],
      providers: [
        { provide: TenantRoomsService, useValue: roomsService },
        { provide: RoomsPdfService, useValue: {} },
        { provide: RoomsXlsxService, useValue: {} },
      ],
    }).compile();
    controller = moduleRef.get(TenantRoomsController);
  });

  it('a stays.read actor: includeOccupancy resolves true and is forwarded to roomsService.list', async () => {
    const query: ListRoomsQueryDto = {} as ListRoomsQueryDto;

    await controller.list(user, query);

    expect(roomsService.list).toHaveBeenCalledWith('hotel-1', query, true);
  });

  it('Epic 22 final review, I2 — a stays.read-less actor (e.g. Housekeeping) resolves includeOccupancy: false', async () => {
    const query: ListRoomsQueryDto = {} as ListRoomsQueryDto;

    await controller.list(housekeepingUser, query);

    expect(roomsService.list).toHaveBeenCalledWith('hotel-1', query, false);
  });
});
