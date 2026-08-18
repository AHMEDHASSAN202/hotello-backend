import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 11 — rooms foundation (Story 11.1).
 *
 * - Splits `hotels.roomsCount` into two columns: the rename preserves the
 *   sales-declared value from onboarding as `declaredRoomsCount` (reference
 *   only, 11.6 AC2); a fresh `roomsCount` is re-added as the derived counter
 *   (active + out_of_service rooms), starting truthfully at 0 since no rooms
 *   exist yet. Also adds `qrGeneratedAt` for the setup checklist.
 * - Creates `room_types` and `rooms` (named UQ constraints, hashed FK names,
 *   `IDX_rooms_hotel_status` for the room-list status filter) and backfills
 *   the three default room types into every existing hotel.
 * - Backfills `rooms.read/create/update` onto the seeded operational roles
 *   (Manager/Front Desk/Housekeeping) for every existing hotel, mirroring
 *   `DEFAULT_TENANT_ROLES`.
 */
export class RoomsFoundation1786000000000 implements MigrationInterface {
  name = 'RoomsFoundation1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Preserve the existing declared-count values under the new name.
    await queryRunner.query(`
      ALTER TABLE "hotels" RENAME COLUMN "roomsCount" TO "declaredRoomsCount"
    `);

    // 2. Re-add "roomsCount" as the derived counter; truthfully 0 until rooms
    // are created (11.6 AC1 syncs it going forward).
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "roomsCount" integer NOT NULL DEFAULT '0'
    `);
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "qrGeneratedAt" TIMESTAMP WITH TIME ZONE
    `);

    // 3. Data layer for room types and rooms.
    await queryRunner.query(`
      CREATE TABLE "room_types" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hotelId" uuid NOT NULL,
        "nameEn" character varying NOT NULL,
        "nameAr" character varying NOT NULL,
        "descriptionEn" text,
        "descriptionAr" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_room_types_hotel_name_en" UNIQUE ("hotelId", "nameEn"),
        CONSTRAINT "UQ_room_types_hotel_name_ar" UNIQUE ("hotelId", "nameAr"),
        CONSTRAINT "PK_b6e1d0a9b67d4b9fbff9c35ab69" PRIMARY KEY ("id"),
        CONSTRAINT "FK_7ed42fc166559badb3c937c400c" FOREIGN KEY ("hotelId")
          REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hotelId" uuid NOT NULL,
        "roomNumber" character varying(20) NOT NULL,
        "floor" integer,
        "roomTypeId" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rooms_hotel_number" UNIQUE ("hotelId", "roomNumber"),
        CONSTRAINT "PK_0368a2d7c215f2d0458a54933f2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e9d4d68c8c47b7fe47b8e233f60" FOREIGN KEY ("hotelId")
          REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_76b20e23154532d6fc4a0f0ea27" FOREIGN KEY ("roomTypeId")
          REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rooms_hotel_status" ON "rooms" ("hotelId", "status")
    `);

    // 4. Backfill the three defaults for every existing hotel (idempotent via
    // NOT EXISTS). One INSERT per type keeps the params typed cleanly and
    // mirrors DEFAULT_ROOM_TYPES.
    const defaults: Array<{
      nameEn: string;
      nameAr: string;
      descriptionEn: string;
      descriptionAr: string;
    }> = [
      {
        nameEn: 'Standard',
        nameAr: 'قياسية',
        descriptionEn: 'Standard room.',
        descriptionAr: 'غرفة قياسية.',
      },
      {
        nameEn: 'Deluxe',
        nameAr: 'ديلوكس',
        descriptionEn: 'Deluxe room with upgraded amenities.',
        descriptionAr: 'غرفة ديلوكس بتجهيزات محسّنة.',
      },
      {
        nameEn: 'Suite',
        nameAr: 'جناح',
        descriptionEn: 'Suite with separate living area.',
        descriptionAr: 'جناح بمنطقة معيشة منفصلة.',
      },
    ];
    for (const def of defaults) {
      await queryRunner.query(
        `
        INSERT INTO "room_types"
          ("hotelId", "nameEn", "nameAr", "descriptionEn", "descriptionAr")
        SELECT h."id", $1::text, $2::text, $3::text, $4::text
        FROM "hotels" h
        WHERE NOT EXISTS (
          SELECT 1 FROM "room_types" rt
          WHERE rt."hotelId" = h."id" AND rt."nameEn" = $1::text
        )
        `,
        [def.nameEn, def.nameAr, def.descriptionEn, def.descriptionAr],
      );
    }

    // 5. Backfill role permissions for the seeded operational roles — append
    // only what's missing so a hotel's already-customized roles are untouched
    // beyond adding the new keys.
    await queryRunner.query(`
      UPDATE "tenant_roles" SET "permissions" = "permissions" || ARRAY['rooms.read','rooms.create','rooms.update']
      WHERE "isSystem" = false AND "nameEn" = 'Manager' AND NOT ("permissions" @> ARRAY['rooms.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles" SET "permissions" = "permissions" || ARRAY['rooms.read']
      WHERE "isSystem" = false AND "nameEn" = 'Front Desk' AND NOT ("permissions" @> ARRAY['rooms.read'])
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles" SET "permissions" = "permissions" || ARRAY['rooms.read','rooms.update']
      WHERE "isSystem" = false AND "nameEn" = 'Housekeeping' AND NOT ("permissions" @> ARRAY['rooms.read'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse 5 — best-effort: remove exactly the keys this migration added.
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove(array_remove("permissions", 'rooms.read'), 'rooms.create'), 'rooms.update')
      WHERE "isSystem" = false AND "nameEn" = 'Manager'
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'rooms.read')
      WHERE "isSystem" = false AND "nameEn" = 'Front Desk'
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove("permissions", 'rooms.read'), 'rooms.update')
      WHERE "isSystem" = false AND "nameEn" = 'Housekeeping'
    `);

    // Reverse 3/4 — dependent table first.
    await queryRunner.query(`ALTER TABLE "rooms" DROP CONSTRAINT "FK_76b20e23154532d6fc4a0f0ea27"`);
    await queryRunner.query(`ALTER TABLE "rooms" DROP CONSTRAINT "FK_e9d4d68c8c47b7fe47b8e233f60"`);
    await queryRunner.query(`ALTER TABLE "room_types" DROP CONSTRAINT "FK_7ed42fc166559badb3c937c400c"`);
    await queryRunner.query(`DROP INDEX "IDX_rooms_hotel_status"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
    await queryRunner.query(`DROP TABLE "room_types"`);

    // Reverse 2.
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "qrGeneratedAt"`);
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "roomsCount"`);

    // Reverse 1.
    await queryRunner.query(`
      ALTER TABLE "hotels" RENAME COLUMN "declaredRoomsCount" TO "roomsCount"
    `);
  }
}
