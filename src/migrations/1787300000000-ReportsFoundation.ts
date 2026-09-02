import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 22 — Reports & Analytics foundation.
 *
 * 1 — `housekeeping_events`: one row per housekeeping state transition
 *     ('flagged'/'started'/'completed'/'interrupted'/'cleared'/'dnd_set'/
 *     'dnd_cleared') — a dedicated analytics-source table for housekeeping
 *     history and per-attendant workload reporting. `stay_room_changes`: one
 *     row per room change during a stay — the room-change-count report
 *     metric's source. Both are deliberately NOT mined from `audit_logs`
 *     jsonb: these are daily-use recurring report sources, not one-off
 *     compliance lookups, and `audit_logs` remains the compliance trail only
 *     (this migration adds no index to `audit_logs`). Both tables start
 *     empty — this is a pre-production system with no meaningful history to
 *     backfill.
 * 2 — Four new indexes on EXISTING tables, each driving a specific report
 *     query: `IDX_stays_hotel_checkin`/`IDX_stays_hotel_checkout` (occupancy
 *     arrivals/departures by day), `IDX_fnb_orders_hotel_delivered` (dining
 *     revenue-by-day, delivered-only per the All-Inclusive honesty rule),
 *     `IDX_event_bookings_hotel_created` (the events booking feed).
 * 3 — roles backfill: existing hotels' Manager gains `reports.read` +
 *     `reports.revenue` + `reports.export`, Front Desk gains `reports.read`
 *     only (grant-by-nameEn on non-system roles — the recorded Epic 11
 *     ruling; new hotels seed from default-tenant-roles). Revenue visibility
 *     is a distinct third key, not implied by `reports.read`, so Front Desk
 *     sees operational reports without seeing money.
 *
 * No plans backfill for `analytics` — deliberate, unlike every prior module
 * epic. `analytics` is the paid upsell; Super Admin enables it per plan
 * through the existing plans UI. No `audit_logs` changes — audit stays
 * compliance-only, `housekeeping_events`/`stay_room_changes` are the
 * analytics source.
 *
 * FK/PK/index constraint names are TypeORM's own hashes (harvested via a
 * throwaway `migration:generate`) so `npm run migration:check` reports no
 * drift. `hotelId` on both tables FKs to `hotels` (the Announcement/FnbOrder
 * aggregate-root precedent); `roomId`/`fromRoomId`/`toRoomId` FK to `rooms`;
 * `actorId`/`assignedToId` (housekeeping_events) FK to `tenant_users`,
 * matching every `*ById`/actor column precedent elsewhere in this repo.
 */
export class ReportsFoundation1787300000000 implements MigrationInterface {
  name = 'ReportsFoundation1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1a — housekeeping_events
    await queryRunner.query(
      `CREATE TABLE "housekeeping_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "roomId" uuid NOT NULL, "eventType" character varying(16) NOT NULL, "cleaningType" character varying(10), "actorId" uuid, "assignedToId" uuid, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_f9c27214110a0a1a7d50d3e6fea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_housekeeping_events_hotel_occurred" ON "housekeeping_events" ("hotelId", "occurredAt") `,
    );

    // 1b — stay_room_changes
    await queryRunner.query(
      `CREATE TABLE "stay_room_changes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "stayId" uuid NOT NULL, "fromRoomId" uuid, "toRoomId" uuid NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_a097721e420dd641cb087417405" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stay_room_changes_hotel_occurred" ON "stay_room_changes" ("hotelId", "occurredAt") `,
    );

    // 2 — query-driver indexes on existing tables (occupancy arrivals/
    // departures, dining revenue-by-day, event bookings feed)
    await queryRunner.query(
      `CREATE INDEX "IDX_stays_hotel_checkin" ON "stays" ("hotelId", "checkInDate") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stays_hotel_checkout" ON "stays" ("hotelId", "checkOutDate") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_orders_hotel_delivered" ON "fnb_orders" ("hotelId", "deliveredAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_bookings_hotel_created" ON "event_bookings" ("hotelId", "createdAt") `,
    );

    // FKs — housekeeping_events
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" ADD CONSTRAINT "FK_2dd60bfb33485d340e8e3ffd31d" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" ADD CONSTRAINT "FK_17a8152118241c3684725405fe8" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" ADD CONSTRAINT "FK_5ed3f29a115f3020af71a6b6a5c" FOREIGN KEY ("actorId") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" ADD CONSTRAINT "FK_4da190c03dfd2b273d6eb999b05" FOREIGN KEY ("assignedToId") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // FKs — stay_room_changes
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" ADD CONSTRAINT "FK_c30877af607907fc58d0e9ce247" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" ADD CONSTRAINT "FK_fd9104c6a9f9fc4def12d3b0300" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" ADD CONSTRAINT "FK_039764a0f08ddf3bd7fd99726a1" FOREIGN KEY ("fromRoomId") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" ADD CONSTRAINT "FK_848fa1f34efd9c10c6291950f3a" FOREIGN KEY ("toRoomId") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 3 — existing Manager gains reports.read/.revenue/.export, Front Desk
    // gains reports.read only
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['reports.read','reports.revenue','reports.export']
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
        AND NOT ("permissions" @> ARRAY['reports.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['reports.read']
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
        AND NOT ("permissions" @> ARRAY['reports.read'])
    `);

    // No plans backfill for `analytics` — deliberate, it's the paid upsell.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 3 — reverse permission grants first.
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'reports.read')
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove(array_remove("permissions", 'reports.read'), 'reports.revenue'), 'reports.export')
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
    `);

    // FKs — stay_room_changes
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" DROP CONSTRAINT "FK_848fa1f34efd9c10c6291950f3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" DROP CONSTRAINT "FK_039764a0f08ddf3bd7fd99726a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" DROP CONSTRAINT "FK_fd9104c6a9f9fc4def12d3b0300"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stay_room_changes" DROP CONSTRAINT "FK_c30877af607907fc58d0e9ce247"`,
    );

    // FKs — housekeeping_events
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" DROP CONSTRAINT "FK_4da190c03dfd2b273d6eb999b05"`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" DROP CONSTRAINT "FK_5ed3f29a115f3020af71a6b6a5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" DROP CONSTRAINT "FK_17a8152118241c3684725405fe8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "housekeeping_events" DROP CONSTRAINT "FK_2dd60bfb33485d340e8e3ffd31d"`,
    );

    // 2 — drop query-driver indexes on existing tables.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_event_bookings_hotel_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fnb_orders_hotel_delivered"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_stays_hotel_checkout"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stays_hotel_checkin"`);

    // 1b — drop stay_room_changes index + table.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_stay_room_changes_hotel_occurred"`,
    );
    await queryRunner.query(`DROP TABLE "stay_room_changes"`);

    // 1a — drop housekeeping_events index + table.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_housekeeping_events_hotel_occurred"`,
    );
    await queryRunner.query(`DROP TABLE "housekeeping_events"`);
  }
}
