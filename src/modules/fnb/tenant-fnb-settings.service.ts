import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';

export interface FnbSettingsView {
  /** Cash on delivery is always available (16.4 AC1) — never a toggle. */
  cashEnabled: true;
  roomChargeEnabled: boolean;
}

/**
 * Epic 16, Story 16.4 — payment-methods configuration. Cash is always on;
 * room charge (pay at checkout) is the only opt-in. Stored as a column on
 * hotels (established small-settings precedent); online payment is a future
 * epic, deliberately absent.
 */
@Injectable()
export class TenantFnbSettingsService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getSettings(hotelId: string): Promise<FnbSettingsView> {
    const hotel = await this.loadHotel(hotelId);
    return { cashEnabled: true, roomChargeEnabled: hotel.fnbRoomChargeEnabled };
  }

  async updateSettings(
    actor: TenantUser,
    roomChargeEnabled: boolean,
  ): Promise<FnbSettingsView> {
    const hotel = await this.loadHotel(actor.hotelId);
    if (hotel.fnbRoomChargeEnabled !== roomChargeEnabled) {
      const diff = {
        fnbRoomChargeEnabled: {
          from: hotel.fnbRoomChargeEnabled,
          to: roomChargeEnabled,
        },
      };
      hotel.fnbRoomChargeEnabled = roomChargeEnabled;
      await this.hotelsRepo.save(hotel);
      await this.auditLogs.log({
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: hotel.id,
        actorId: actor.id,
        metadata: { actorType: 'tenant_user', hotelId: hotel.id, diff },
      });
    }
    return { cashEnabled: true, roomChargeEnabled: hotel.fnbRoomChargeEnabled };
  }

  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }
}
