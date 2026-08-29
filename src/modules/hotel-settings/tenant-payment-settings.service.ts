import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';

export interface PaymentSettingsView {
  /** Cash on delivery is always available (16.4 AC1) — never a toggle. */
  cashEnabled: true;
  roomChargeEnabled: boolean;
}

/**
 * Epic 21, Story 21.1 AC2 — hotel-level payment-methods config (Epic 16
 * origin, lifted here). Cash is always on; room charge (pay at checkout) is
 * the only opt-in. Stored as a single column on hotels; F&B and Events both
 * read this single source of truth (`hotel.roomChargeEnabled`) instead of
 * each owning their own copy.
 */
@Injectable()
export class TenantPaymentSettingsService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getSettings(hotelId: string): Promise<PaymentSettingsView> {
    const hotel = await this.loadHotel(hotelId);
    return { cashEnabled: true, roomChargeEnabled: hotel.roomChargeEnabled };
  }

  async updateSettings(
    actor: TenantUser,
    roomChargeEnabled: boolean,
  ): Promise<PaymentSettingsView> {
    const hotel = await this.loadHotel(actor.hotelId);
    if (hotel.roomChargeEnabled !== roomChargeEnabled) {
      const diff = {
        roomChargeEnabled: {
          from: hotel.roomChargeEnabled,
          to: roomChargeEnabled,
        },
      };
      hotel.roomChargeEnabled = roomChargeEnabled;
      await this.hotelsRepo.save(hotel);
      await this.auditLogs.log({
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: hotel.id,
        actorId: actor.id,
        metadata: { actorType: 'tenant_user', hotelId: hotel.id, diff },
      });
    }
    return { cashEnabled: true, roomChargeEnabled: hotel.roomChargeEnabled };
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
