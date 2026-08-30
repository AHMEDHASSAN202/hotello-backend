import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConnectionOptions } from './config/database.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantAccessGuard } from './common/guards/tenant-access.guard';
import { TenantJwtAuthGuard } from './common/guards/tenant-jwt-auth.guard';
import { GuestJwtAuthGuard } from './common/guards/guest-jwt-auth.guard';
import { AdminsModule } from './modules/admins/admins.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrandingModule } from './modules/branding/branding.module';
import { HotelsModule } from './modules/hotels/hotels.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlansModule } from './modules/plans/plans.module';
import { RolesModule } from './modules/roles/roles.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { TenantAccessModule } from './modules/tenant-access/tenant-access.module';
import { TenantAuthModule } from './modules/tenant-auth/tenant-auth.module';
import { TenantProfileModule } from './modules/tenant-profile/tenant-profile.module';
import { TenantRolesModule } from './modules/tenant-roles/tenant-roles.module';
import { TenantRoomsModule } from './modules/tenant-rooms/tenant-rooms.module';
import { TenantStaysModule } from './modules/tenant-stays/tenant-stays.module';
import { GuestModule } from './modules/guest/guest.module';
import { RequestsModule } from './modules/requests/requests.module';
import { FnbModule } from './modules/fnb/fnb.module';
import { HotelInfoModule } from './modules/hotel-info/hotel-info.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
import { EventsModule } from './modules/events/events.module';
import { StaySettlementModule } from './modules/stay-settlement/stay-settlement.module';
import { TenantStaffModule } from './modules/tenant-staff/tenant-staff.module';
import { TenantUsersModule } from './modules/tenant-users/tenant-users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      // Same connection settings as the CLI data source (single source of
      // truth). Schema is owned by migrations — never `synchronize`.
      useFactory: () => ({
        ...databaseConnectionOptions(),
        autoLoadEntities: true,
        // Migrations are applied explicitly via `npm run migration:run`, never
        // on app boot (safer for production). See README → Database migrations.
        migrationsRun: false,
      }),
    }),
    ScheduleModule.forRoot(),
    // In-process events decouple business services from notifications (6.1 AC3).
    EventEmitterModule.forRoot(),
    // Guard applied per-route (public setup endpoint), not as APP_GUARD.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    AdminsModule,
    RolesModule,
    AuditLogsModule,
    StorageModule,
    MailModule,
    NotificationsModule,
    HotelsModule,
    PlansModule,
    SubscriptionsModule,
    TenantAccessModule,
    TenantAuthModule,
    TenantProfileModule,
    TenantRolesModule,
    TenantRoomsModule,
    TenantStaysModule,
    GuestModule,
    RequestsModule,
    FnbModule,
    HotelInfoModule,
    AnnouncementsModule,
    HousekeepingModule,
    EventsModule,
    StaySettlementModule,
    BrandingModule,
    TenantStaffModule,
    TenantUsersModule,
  ],
  providers: [
    // Injected into JwtAuthGuard so tenant-scoped routes authenticate with the
    // tenant-jwt strategy; not an APP_GUARD itself.
    TenantJwtAuthGuard,
    GuestJwtAuthGuard,
    // Order matters: authenticate, authorize, enforce access state, then the
    // forced-password-change gate (needs the loaded user; runs last).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: TenantAccessGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {}
