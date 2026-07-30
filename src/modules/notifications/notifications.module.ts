import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { NotificationRetryService } from './notification-retry.service';
import { NotificationOutbox } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

/**
 * Epic 06 — the outbox, the event listeners, the retry poller and the Super
 * Admin log API. Business modules never import this: they emit events and
 * this module does the rest (Story 6.1 AC3).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationOutbox, Hotel, TenantUser]),
    TenantUsersModule,
    AuditLogsModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    NotificationRetryService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
