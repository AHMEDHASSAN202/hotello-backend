import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 16 — F&B ordering foundation.
 *
 * 1 — hotels: `defaultStayType` (16.1 AC2 — pre-selects the check-in field)
 *     and `fnbRoomChargeEnabled` (16.4 AC1 — cash is always on, room charge
 *     is the only opt-in).
 * 2 — stays: `stayType` (16.1 AC1) + backfill from the hotel default
 *     (16.1 AC3 — covers active and historical stays uniformly; the column
 *     default and the hotel default are both 'room_only' at this point, so
 *     the backfill is a no-op today and future-proof if defaults diverge).
 * 3 — F&B tables: fnb_menus / fnb_menu_sections / fnb_items (7-locale JSONB
 *     names, pricing mode `includedFor`, one variant group, photo keys),
 *     fnb_locations (immutable `key` unique per hotel — printed QRs depend
 *     on it, 16.3 AC4), fnb_orders + fnb_order_lines (full snapshots incl.
 *     included flags and unit prices at order time — 16.5 AC4; `updatedAt`
 *     is the delta-polling cursor; `dueAt` stored so overdue is a plain
 *     comparison).
 * 4 — permission backfill for existing hotels' default roles (grants by
 *     role name on non-system roles; recorded Epic 11 ruling): Manager gets
 *     all five fnb keys, Front Desk gets fnb_orders.read.
 * 5 — seeds the new "F&B / Kitchen" default role into existing hotels that
 *     don't have it (new hotels get it via DEFAULT_TENANT_ROLES at
 *     onboarding). Kept in sync with default-tenant-roles.ts.
 *
 * FK/PK constraint names are TypeORM's own hashes (harvested via a throwaway
 * `migration:generate`) so `npm run migration:check` reports no drift.
 */
export class FnbFoundation1786400000000 implements MigrationInterface {
  name = 'FnbFoundation1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — hotel settings columns
    await queryRunner.query(
      `ALTER TABLE "hotels" ADD "defaultStayType" character varying(20) NOT NULL DEFAULT 'room_only'`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotels" ADD "fnbRoomChargeEnabled" boolean NOT NULL DEFAULT false`,
    );

    // 2 — stay type + backfill from the hotel default (16.1 AC3)
    await queryRunner.query(
      `ALTER TABLE "stays" ADD "stayType" character varying(20) NOT NULL DEFAULT 'room_only'`,
    );
    await queryRunner.query(`
      UPDATE "stays" s
      SET "stayType" = h."defaultStayType"
      FROM "hotels" h
      WHERE s."hotelId" = h."id" AND s."stayType" <> h."defaultStayType"
    `);

    // 3 — F&B tables + indexes
    await queryRunner.query(
      `CREATE TABLE "fnb_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "stayId" uuid NOT NULL, "roomId" uuid NOT NULL, "roomNumber" character varying(20) NOT NULL, "guestName" character varying(120) NOT NULL, "guestLanguage" character varying(5) NOT NULL, "stayType" character varying(20) NOT NULL, "menuIds" jsonb NOT NULL, "destinationType" character varying(10) NOT NULL, "locationId" uuid, "locationKey" character varying(60), "locationNames" jsonb, "spot" character varying(10), "paymentMethod" character varying(20), "totalAmount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "status" character varying NOT NULL DEFAULT 'new', "slaTargetMinutes" integer NOT NULL, "dueAt" TIMESTAMP WITH TIME ZONE NOT NULL, "assignedToId" uuid, "startedById" uuid, "deliveredById" uuid, "cancelledById" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "outForDeliveryAt" TIMESTAMP WITH TIME ZONE, "deliveredAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledReason" character varying(20), "cancelNote" text, "settledAt" TIMESTAMP WITH TIME ZONE, "settledById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_530029f4148c6223316a449dcec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_orders_hotel_created" ON "fnb_orders" ("hotelId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_orders_stay" ON "fnb_orders" ("stayId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_orders_hotel_updated" ON "fnb_orders" ("hotelId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_orders_hotel_status" ON "fnb_orders" ("hotelId", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fnb_order_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "hotelId" uuid NOT NULL, "itemId" uuid NOT NULL, "itemNames" jsonb NOT NULL, "variantKey" character varying(40), "variantLabel" jsonb, "variantOptionNames" jsonb, "quantity" integer NOT NULL, "unitPrice" numeric(10,2) NOT NULL, "included" boolean NOT NULL, "lineTotal" numeric(10,2) NOT NULL, "note" text, "photoThumbKey" character varying, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57be84618d0474c3fd8dc5867cf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_order_lines_order" ON "fnb_order_lines" ("orderId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fnb_menus" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "names" jsonb NOT NULL, "descriptions" jsonb, "windows" jsonb NOT NULL DEFAULT '[]', "defaultIncludedFor" jsonb NOT NULL DEFAULT '[]', "prepSlaMinutes" integer NOT NULL DEFAULT '30', "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e6238d0e79d94a86810f600bd48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_menus_hotel" ON "fnb_menus" ("hotelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fnb_menu_sections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "menuId" uuid NOT NULL, "names" jsonb NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9c5b02762272aab7e2f7cff6dd3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_menu_sections_menu" ON "fnb_menu_sections" ("menuId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fnb_locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "key" character varying(60) NOT NULL, "names" jsonb NOT NULL, "hasSpots" boolean NOT NULL DEFAULT false, "spotLabel" jsonb, "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fnb_locations_hotel_key" UNIQUE ("hotelId", "key"), CONSTRAINT "PK_1b15338feee637690e62deecf2e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "fnb_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "menuId" uuid NOT NULL, "sectionId" uuid NOT NULL, "names" jsonb NOT NULL, "descriptions" jsonb, "photoKeys" jsonb, "price" numeric(10,2) NOT NULL, "includedFor" jsonb, "variant" jsonb, "allowNotes" boolean NOT NULL DEFAULT true, "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bf2a8f5e6b1070f4a8293e9b8c4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_items_hotel" ON "fnb_items" ("hotelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fnb_items_section" ON "fnb_items" ("sectionId") `,
    );

    // FKs — TypeORM hash names, no drift.
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_4cba2865523244e64290b8e633e" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_0be2d0ea49117134d2e84f61f40" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_2067642c838dd10586207e1df50" FOREIGN KEY ("assignedToId") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_87e34a56b0bf0c24030495eb94f" FOREIGN KEY ("startedById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_fe6ff3515699714843cdd17d6e5" FOREIGN KEY ("deliveredById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_a4e6cf2e30ac480f47858afe65c" FOREIGN KEY ("cancelledById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" ADD CONSTRAINT "FK_229818849c04fa8dcb2eeee1602" FOREIGN KEY ("settledById") REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_order_lines" ADD CONSTRAINT "FK_b03efcae6b6e91c5788ec65be3b" FOREIGN KEY ("orderId") REFERENCES "fnb_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_menus" ADD CONSTRAINT "FK_39300bee9dde26c1c82c0a58361" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_menu_sections" ADD CONSTRAINT "FK_d2a9aa7b92feb81af9df01ffec9" FOREIGN KEY ("menuId") REFERENCES "fnb_menus"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_locations" ADD CONSTRAINT "FK_1f31f2443e0ea2c0f7d570e57b6" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_items" ADD CONSTRAINT "FK_7a7957eab63caf32381c708ada0" FOREIGN KEY ("sectionId") REFERENCES "fnb_menu_sections"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 4 — permission backfill for existing hotels (per spec header):
    // Manager gets all five; Front Desk gets read-only board access.
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['fnb_menus.manage','fnb_locations.manage','fnb_orders.read','fnb_orders.update','fnb_settings.manage']
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
        AND NOT ("permissions" @> ARRAY['fnb_orders.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['fnb_orders.read']
      WHERE "isSystem" = false
        AND "nameEn" = 'Front Desk'
        AND NOT ("permissions" @> ARRAY['fnb_orders.read'])
    `);

    // 5 — seed the new default role into existing hotels (kept in sync with
    // default-tenant-roles.ts; new hotels seed it at onboarding).
    await queryRunner.query(`
      INSERT INTO "tenant_roles" ("hotelId", "nameEn", "nameAr", "descriptionEn", "descriptionAr", "permissions", "isSystem")
      SELECT h."id", 'F&B / Kitchen', 'الأغذية والمشروبات',
             'Works the kitchen board and manages the menus.',
             'يعمل على لوحة المطبخ ويدير قوائم الطعام.',
             ARRAY['fnb_orders.read','fnb_orders.update','fnb_menus.manage'],
             false
      FROM "hotels" h
      WHERE NOT EXISTS (
        SELECT 1 FROM "tenant_roles" r
        WHERE r."hotelId" = h."id" AND r."nameEn" = 'F&B / Kitchen'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 5/4 — reverse role seeding and permission grants first.
    await queryRunner.query(`
      DELETE FROM "tenant_roles"
      WHERE "isSystem" = false AND "nameEn" = 'F&B / Kitchen'
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove(array_remove(array_remove(array_remove(
        "permissions", 'fnb_menus.manage'), 'fnb_locations.manage'), 'fnb_orders.read'), 'fnb_orders.update'), 'fnb_settings.manage')
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
    `);

    await queryRunner.query(
      `ALTER TABLE "fnb_items" DROP CONSTRAINT "FK_7a7957eab63caf32381c708ada0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_locations" DROP CONSTRAINT "FK_1f31f2443e0ea2c0f7d570e57b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_menu_sections" DROP CONSTRAINT "FK_d2a9aa7b92feb81af9df01ffec9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_menus" DROP CONSTRAINT "FK_39300bee9dde26c1c82c0a58361"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_order_lines" DROP CONSTRAINT "FK_b03efcae6b6e91c5788ec65be3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_229818849c04fa8dcb2eeee1602"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_a4e6cf2e30ac480f47858afe65c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_fe6ff3515699714843cdd17d6e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_87e34a56b0bf0c24030495eb94f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_2067642c838dd10586207e1df50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_0be2d0ea49117134d2e84f61f40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fnb_orders" DROP CONSTRAINT "FK_4cba2865523244e64290b8e633e"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_items_section"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_items_hotel"`);
    await queryRunner.query(`DROP TABLE "fnb_items"`);
    await queryRunner.query(`DROP TABLE "fnb_locations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_menu_sections_menu"`);
    await queryRunner.query(`DROP TABLE "fnb_menu_sections"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_menus_hotel"`);
    await queryRunner.query(`DROP TABLE "fnb_menus"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_order_lines_order"`);
    await queryRunner.query(`DROP TABLE "fnb_order_lines"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_orders_hotel_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_orders_hotel_updated"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_orders_stay"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fnb_orders_hotel_created"`);
    await queryRunner.query(`DROP TABLE "fnb_orders"`);
    await queryRunner.query(`ALTER TABLE "stays" DROP COLUMN "stayType"`);
    await queryRunner.query(
      `ALTER TABLE "hotels" DROP COLUMN "fnbRoomChargeEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hotels" DROP COLUMN "defaultStayType"`,
    );
  }
}
