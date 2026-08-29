import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 21 — Events & Workshops foundation.
 *
 * 1 — `events`: one row per event. `titles`/`descriptions` are 7-locale maps
 *     (the Announcements/F&B convention); `startAtLocal`/`endAtLocal` are
 *     hotel-local 'YYYY-MM-DD HH:MM' strings (the `Announcement.publishAtLocal`
 *     convention, string-compared, never converted to UTC). `includedFor` is
 *     two-state only ([] = paid for everyone, non-empty = included for those
 *     stay types) — events have no parent menu default to inherit, unlike
 *     F&B items. Events are never hard-deleted (`cancelled`/`completed` are
 *     terminal statuses).
 * 2 — `event_bookings`: a guest's booking for an event. `snapshot` freezes
 *     what the guest was shown at booking time — event edits must never
 *     rewrite it (the F&B order-line precedent). No cascade delete from
 *     `events` (events are never hard-deleted).
 * 3 — roles backfill: existing hotels' Manager gains `events.manage`, Front
 *     Desk gains `events.read` (grant-by-nameEn on non-system roles — the
 *     recorded Epic 11 ruling; new hotels seed from default-tenant-roles).
 * 4 — plans backfill: every existing plan gains the `events` module
 *     (the Epic 17/19/20 form — backfilled onto existing plans).
 *
 * FK/PK/index constraint names are TypeORM's own hashes (harvested via a
 * throwaway `migration:generate`) so `npm run migration:check` reports no
 * drift. `hotelId`, `cancelledById` (events) and `settledById`
 * (event_bookings) are denormalized uuid columns with no FK constraint —
 * matching the `fnb_items` precedent (no `hotels` FK) and the terse field
 * list in the Epic 21 Task 3 brief, which only calls out FKs for
 * `infoEntryId`, `createdById`, `eventId` and `stayId`.
 */
export class EventsFoundation1787000000000 implements MigrationInterface {
  name = 'EventsFoundation1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — events
    await queryRunner.query(
      `CREATE TABLE "events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "titles" jsonb NOT NULL DEFAULT '{}', "descriptions" jsonb NOT NULL DEFAULT '{}', "photoKeys" jsonb, "startAtLocal" character varying(16) NOT NULL, "endAtLocal" character varying(16), "locationText" character varying(200) NOT NULL, "infoEntryId" uuid, "capacity" integer, "price" numeric(10,2) NOT NULL DEFAULT '0', "includedFor" jsonb NOT NULL DEFAULT '[]', "status" character varying(12) NOT NULL DEFAULT 'draft', "cancelReason" text, "createdById" uuid NOT NULL, "publishedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "cancelledById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_40731c7151fe4be3116e45ddf73" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_hotel_start" ON "events" ("hotelId", "startAtLocal") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_hotel_status" ON "events" ("hotelId", "status") `,
    );

    // 2 — event_bookings
    await queryRunner.query(
      `CREATE TABLE "event_bookings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "eventId" uuid NOT NULL, "stayId" uuid NOT NULL, "partySize" integer NOT NULL, "snapshot" jsonb NOT NULL, "unitPrice" numeric(10,2) NOT NULL, "included" boolean NOT NULL DEFAULT false, "totalAmount" numeric(10,2) NOT NULL DEFAULT '0', "currency" character varying(3) NOT NULL, "paymentMethod" character varying(20), "status" character varying(10) NOT NULL DEFAULT 'booked', "cancelledBy" character varying(10), "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledReason" text, "settledAt" TIMESTAMP WITH TIME ZONE, "settledById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4dc8a88e1e0e70fd7687d57acde" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_bookings_hotel_status" ON "event_bookings" ("hotelId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_bookings_stay" ON "event_bookings" ("stayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_bookings_event" ON "event_bookings" ("eventId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_91d55fad2f6a2cf8b54a61863ab" FOREIGN KEY ("infoEntryId") REFERENCES "hotel_info_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_2fb864f37ad210f4295a09b684d" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_bookings" ADD CONSTRAINT "FK_2d2bea03d5668bd4f76577d8465" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_bookings" ADD CONSTRAINT "FK_67c69e1859f5712efffcfd6b14e" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 3 — existing Manager gains events.manage, Front Desk gains events.read
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['events.manage','events.read']
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
        AND NOT ("permissions" @> ARRAY['events.manage'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['events.read']
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
        AND NOT ("permissions" @> ARRAY['events.read'])
    `);

    // 4 — enable the module on every existing plan
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_append("enabledModules", 'events')
      WHERE NOT ("enabledModules" @> ARRAY['events'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 4/3 — reverse plan enablement and permission grants first.
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_remove("enabledModules", 'events')
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'events.read')
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove("permissions", 'events.manage'), 'events.read')
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
    `);

    // 2/1 — drop FKs, then indexes, then tables.
    await queryRunner.query(
      `ALTER TABLE "event_bookings" DROP CONSTRAINT "FK_67c69e1859f5712efffcfd6b14e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_bookings" DROP CONSTRAINT "FK_2d2bea03d5668bd4f76577d8465"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "FK_2fb864f37ad210f4295a09b684d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "FK_91d55fad2f6a2cf8b54a61863ab"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_event_bookings_event"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_event_bookings_stay"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_event_bookings_hotel_status"`,
    );
    await queryRunner.query(`DROP TABLE "event_bookings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_events_hotel_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_events_hotel_start"`);
    await queryRunner.query(`DROP TABLE "events"`);
  }
}
