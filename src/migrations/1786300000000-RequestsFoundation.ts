import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 15 — Guest Requests foundation.
 *
 * 1. `request_categories` — platform-owned category rows (shared across all
 *    hotels; translations JSONB `{ar,en,ru,fr,it,es,de}`, one row per
 *    category — spec note 2). Seeded by `seedRequestCatalog` (idempotent by
 *    `key`), not per hotel.
 * 2. `request_items` — catalog items. `hotelId IS NULL` = platform item
 *    (read-only translations for hotels, 15.1 AC2; unique per category by
 *    `key` via a partial index). `hotelId` set = the hotel's custom item
 *    (15.1 AC4). Items are never hard-deleted.
 * 3. `hotel_request_category_settings` / `hotel_request_item_settings` —
 *    per-hotel curation (enable/order/SLA, 15.1 AC2). Row/column absence =
 *    platform default, so a new hotel needs zero rows (recorded decision:
 *    shared rows keep platform translation updates propagatable).
 * 4. `requests` — permanent request records with submission-time snapshots
 *    (item names/icon, SLA target, room id+number — 15.1 AC5 / note 6),
 *    lifecycle timestamps per transition, and `dueAt` for overdue queries.
 *    `updatedAt` is the delta-polling cursor (note 4).
 * 5. Permission backfill — grants the Epic 15 keys to the default
 *    operational roles by name on non-system roles (Epic 11 ruling):
 *    Manager all four, Front Desk read/update/assign, Housekeeping
 *    read/update. New hotels get them via DEFAULT_TENANT_ROLES.
 *
 * PK/FK names are TypeORM's hashes (harvested via a throwaway
 * `migration:generate`) so `migration:check` reports no drift.
 */
export class RequestsFoundation1786300000000 implements MigrationInterface {
  name = 'RequestsFoundation1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "request_categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying(40) NOT NULL, "icon" character varying(40) NOT NULL, "names" jsonb NOT NULL, "sortOrder" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_905d400d284af01d802da64461f" UNIQUE ("key"), CONSTRAINT "PK_5651f087e4373bbc4c5f1eb92e0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "request_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "categoryId" uuid NOT NULL, "hotelId" uuid, "key" character varying(60), "names" jsonb NOT NULL, "descriptions" jsonb, "icon" character varying(40) NOT NULL, "optionType" character varying(10), "optionMin" integer, "optionMax" integer, "defaultSlaMinutes" integer NOT NULL, "sortOrder" integer NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_400276415bc0e472f04b55f1b1b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_items_hotel" ON "request_items" ("hotelId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_items_category" ON "request_items" ("categoryId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_request_items_platform_key" ON "request_items" ("categoryId", "key") WHERE "hotelId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "stayId" uuid NOT NULL, "roomId" uuid NOT NULL, "roomNumber" character varying(20) NOT NULL, "itemId" uuid NOT NULL, "categoryId" uuid NOT NULL, "itemNames" jsonb NOT NULL, "itemIcon" character varying(40) NOT NULL, "optionType" character varying(10), "optionValue" character varying(10), "note" text, "noteLanguage" character varying(5), "status" character varying NOT NULL DEFAULT 'new', "slaTargetMinutes" integer NOT NULL, "dueAt" TIMESTAMP WITH TIME ZONE NOT NULL, "assignedToId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "startedById" uuid, "completedAt" TIMESTAMP WITH TIME ZONE, "completedById" uuid, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledById" uuid, "cancelledReason" character varying(20), "cancelNote" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0428f484e96f9e6a55955f29b5f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requests_hotel_created" ON "requests" ("hotelId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requests_stay" ON "requests" ("stayId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requests_hotel_updated" ON "requests" ("hotelId", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_requests_hotel_status" ON "requests" ("hotelId", "status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "hotel_request_item_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "itemId" uuid NOT NULL, "enabled" boolean, "sortOrder" integer, "slaMinutes" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_hotel_request_item" UNIQUE ("hotelId", "itemId"), CONSTRAINT "PK_e344562ea0d30cd3f42e942ce5b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "hotel_request_category_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "categoryId" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_hotel_request_category" UNIQUE ("hotelId", "categoryId"), CONSTRAINT "PK_c52768aaf091d52c333f28fe912" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_items" ADD CONSTRAINT "FK_9ffe17de856c3127b75af736137" FOREIGN KEY ("categoryId") REFERENCES "request_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_items" ADD CONSTRAINT "FK_320ea31aa6c0de0dc1bc664b475" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_60835494fb764c54ff03ce278cb" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_583c8da48e84c1e4e767b3546e7" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_6d15346ed207fac619573861cd7" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_aca6fb66f3b98e21fae400b5f46" FOREIGN KEY ("itemId") REFERENCES "request_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_5a95e8393e257e96fbf0d1cae19" FOREIGN KEY ("categoryId") REFERENCES "request_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_e32dafff32c402bbc9f2b7d43ee" FOREIGN KEY ("assignedToId") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_07c35bf3b5270f43bd1c26c122d" FOREIGN KEY ("startedById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_bc17fdb7083d1f8c54f8682d496" FOREIGN KEY ("completedById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD CONSTRAINT "FK_2998bb71c58d78ce7805bce75a7" FOREIGN KEY ("cancelledById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_item_settings" ADD CONSTRAINT "FK_862d0f9557d13044146c0193b75" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_item_settings" ADD CONSTRAINT "FK_31f22e596f0c36da4beac1b2523" FOREIGN KEY ("itemId") REFERENCES "request_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_category_settings" ADD CONSTRAINT "FK_6a5dd427378b50d6ed6fc9631c6" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_category_settings" ADD CONSTRAINT "FK_8f0eab4e30ed34eb526e85f7cd7" FOREIGN KEY ("categoryId") REFERENCES "request_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // 5 — permission backfill for existing hotels' default operational roles
    // (grants by role name on non-system roles; recorded Epic 11 ruling).
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['requests.read','requests.update','requests.assign','request_catalog.manage']
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
        AND NOT ("permissions" @> ARRAY['requests.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['requests.read','requests.update','requests.assign']
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
        AND NOT ("permissions" @> ARRAY['requests.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['requests.read','requests.update']
      WHERE "isSystem" = false
        AND "nameEn" = 'Housekeeping'
        AND NOT ("permissions" @> ARRAY['requests.read'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove(array_remove(array_remove(
        "permissions", 'requests.read'), 'requests.update'), 'requests.assign'), 'request_catalog.manage')
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk', 'Housekeeping')
    `);
    await queryRunner.query(
      `ALTER TABLE "hotel_request_category_settings" DROP CONSTRAINT "FK_8f0eab4e30ed34eb526e85f7cd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_category_settings" DROP CONSTRAINT "FK_6a5dd427378b50d6ed6fc9631c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_item_settings" DROP CONSTRAINT "FK_31f22e596f0c36da4beac1b2523"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_request_item_settings" DROP CONSTRAINT "FK_862d0f9557d13044146c0193b75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_2998bb71c58d78ce7805bce75a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_bc17fdb7083d1f8c54f8682d496"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_07c35bf3b5270f43bd1c26c122d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_e32dafff32c402bbc9f2b7d43ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_5a95e8393e257e96fbf0d1cae19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_aca6fb66f3b98e21fae400b5f46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_6d15346ed207fac619573861cd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_583c8da48e84c1e4e767b3546e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT "FK_60835494fb764c54ff03ce278cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_items" DROP CONSTRAINT "FK_320ea31aa6c0de0dc1bc664b475"`,
    );
    await queryRunner.query(
      `ALTER TABLE "request_items" DROP CONSTRAINT "FK_9ffe17de856c3127b75af736137"`,
    );
    await queryRunner.query(`DROP TABLE "hotel_request_category_settings"`);
    await queryRunner.query(`DROP TABLE "hotel_request_item_settings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_requests_hotel_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_requests_hotel_updated"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_requests_stay"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_requests_hotel_created"`);
    await queryRunner.query(`DROP TABLE "requests"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_request_items_platform_key"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_request_items_category"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_request_items_hotel"`);
    await queryRunner.query(`DROP TABLE "request_items"`);
    await queryRunner.query(`DROP TABLE "request_categories"`);
  }
}
