import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EventSettlementSource } from '../events/event-settlement-source';
import { EventsModule } from '../events/events.module';
import { FnbSettlementSource } from '../fnb/fnb-settlement-source';
import { FnbModule } from '../fnb/fnb.module';
import { TenantStaysModule } from '../tenant-stays/tenant-stays.module';
import { SETTLEMENT_SOURCES } from './settlement-source.interface';
import { StaySettlementController } from './stay-settlement.controller';
import { StaySettlementService } from './stay-settlement.service';

/**
 * Story 21.6 AC2 — wires the shared `SettlementSource` array. NestJS has no
 * user-land multi-provider merge, so this explicit array factory under one
 * token (`SETTLEMENT_SOURCES`) is the idiomatic pattern for "N modules each
 * contribute one implementation of the same interface" — not a variant of
 * the single-swap `STORAGE_DRIVER` pattern, which only ever picks one.
 */
@Module({
  imports: [FnbModule, EventsModule, TenantStaysModule, AuditLogsModule],
  controllers: [StaySettlementController],
  providers: [
    StaySettlementService,
    {
      provide: SETTLEMENT_SOURCES,
      useFactory: (fnb: FnbSettlementSource, events: EventSettlementSource) => [
        fnb,
        events,
      ],
      inject: [FnbSettlementSource, EventSettlementSource],
    },
  ],
  exports: [StaySettlementService],
})
export class StaySettlementModule {}
