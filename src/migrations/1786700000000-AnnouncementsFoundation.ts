import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 19 — Guest Announcements foundation.
 *
 * 1 — `announcements`: one row per announcement. `audience` is a JSONB FILTER
 *     (19.1 AC3 — dynamic, never a recipient snapshot); `publishAtLocal` /
 *     `activeUntilLocal` are hotel-local 'YYYY-MM-DD HH:MM' strings compared
 *     against the hotel's wall clock (the Epic 13 isStayOverdue approach);
 *     `infoEntryId` deep-links a Hotel Info entry and nulls out if the entry
 *     is ever hard-deleted (singleton sections may be). Retracted/expired
 *     rows are history, never deleted (19.2 AC2).
 * 2 — `announcement_reads`: lazy per-stay read receipts, unique per
 *     (announcement, stay) so mark-read is idempotent. Aggregate-only
 *     surface (19.3 AC3).
 * 3 — roles backfill: existing hotels' Manager + Front Desk gain
 *     `announcements.manage` (grant-by-nameEn on non-system roles — the
 *     recorded Epic 11 ruling; new hotels seed from default-tenant-roles).
 * 4 — plans backfill: every existing plan gains the `announcements` module
 *     (spec header: "backfilled onto existing plans like prior module
 *     additions" — the Epic 17 form, not Epic 18's opt-in upsell form).
 *
 * FK/PK constraint names are TypeORM's own hashes (harvested via a throwaway
 * `migration:generate`) so `npm run migration:check` reports no drift.
 */
export class AnnouncementsFoundation1786700000000 implements MigrationInterface {
  name = 'AnnouncementsFoundation1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — announcements
    await queryRunner.query(
      `CREATE TABLE "announcements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "titles" jsonb NOT NULL DEFAULT '{}', "bodies" jsonb NOT NULL DEFAULT '{}', "infoEntryId" uuid, "priority" boolean NOT NULL DEFAULT false, "audience" jsonb NOT NULL DEFAULT '{}', "status" character varying(12) NOT NULL DEFAULT 'draft', "publishAtLocal" character varying(16), "activeUntilLocal" character varying(16), "publishedAt" TIMESTAMP, "expiredAt" TIMESTAMP, "retractedAt" TIMESTAMP, "createdById" uuid NOT NULL, "retractedById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b3ad760876ff2e19d58e05dc8b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_hotel_status" ON "announcements" ("hotelId", "status") `,
    );

    // 2 — announcement_reads
    await queryRunner.query(
      `CREATE TABLE "announcement_reads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "announcementId" uuid NOT NULL, "stayId" uuid NOT NULL, "readAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_announcement_reads_announcement_stay" UNIQUE ("announcementId", "stayId"), CONSTRAINT "PK_d82327e564612085a67f912bfae" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_reads_stay" ON "announcement_reads" ("stayId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_78e20d54b713a4a247dd3052f2f" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_27f4480839fb85867da345219bb" FOREIGN KEY ("infoEntryId") REFERENCES "hotel_info_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_197a06ce0989e489974fdc26ca8" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcement_reads" ADD CONSTRAINT "FK_77c99446ffea2d8edb5b751e6aa" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcement_reads" ADD CONSTRAINT "FK_ec10881207719f96c831c5e0355" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 3 — existing Manager + Front Desk roles gain announcements.manage
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['announcements.manage']
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
        AND NOT ("permissions" @> ARRAY['announcements.manage'])
    `);

    // 4 — enable the module on every existing plan
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_append("enabledModules", 'announcements')
      WHERE NOT ("enabledModules" @> ARRAY['announcements'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 4/3 — reverse plan enablement and permission grants first.
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_remove("enabledModules", 'announcements')
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'announcements.manage')
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
    `);

    // 2/1 — drop FKs, then indexes, then tables.
    await queryRunner.query(
      `ALTER TABLE "announcement_reads" DROP CONSTRAINT "FK_ec10881207719f96c831c5e0355"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcement_reads" DROP CONSTRAINT "FK_77c99446ffea2d8edb5b751e6aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP CONSTRAINT "FK_197a06ce0989e489974fdc26ca8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP CONSTRAINT "FK_27f4480839fb85867da345219bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP CONSTRAINT "FK_78e20d54b713a4a247dd3052f2f"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_announcement_reads_stay"`);
    await queryRunner.query(`DROP TABLE "announcement_reads"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_announcements_hotel_status"`);
    await queryRunner.query(`DROP TABLE "announcements"`);
  }
}
