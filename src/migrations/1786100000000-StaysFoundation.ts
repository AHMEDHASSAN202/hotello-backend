import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 13 — Stays & Guest Sessions foundation.
 *
 * 1. `stays` table — the room↔guest bridge. The stay code exists only as a
 *    deterministic HMAC hash (`codeHash`); plaintext is never stored.
 * 2. Partial unique index `UQ_stays_room_active` — one active stay per room,
 *    race-safe at the DB level (13.1 AC2: concurrent check-ins → one 23505).
 * 3. Partial unique index `UQ_stays_hotel_code_active` — codes unique among a
 *    hotel's ACTIVE stays only (13.1 AC3); history may repeat codes.
 * 4. `hotels.checkoutTime` — hotel-local auto-checkout hour (13.4 AC2),
 *    'HH:MM', default 12:00.
 * 5. Role backfill — Manager and Front Desk gain the four stays keys
 *    (spec header; Housekeeping gets none). By role NAME on non-system roles,
 *    same ruling as the Epic 11 rooms backfill.
 *
 * PK/FK names are TypeORM's hashes (harvested via a throwaway
 * migration:generate) so `npm run migration:check` reports no drift.
 */
export class StaysFoundation1786100000000 implements MigrationInterface {
  name = 'StaysFoundation1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Stays table
    await queryRunner.query(`
      CREATE TABLE "stays" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hotelId" uuid NOT NULL,
        "roomId" uuid NOT NULL,
        "guestName" character varying(120) NOT NULL,
        "email" character varying,
        "phone" character varying(30),
        "language" character varying(5) NOT NULL,
        "guestsCount" integer,
        "note" text,
        "codeHash" character varying(64) NOT NULL,
        "checkInDate" date NOT NULL,
        "checkOutDate" date NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "checkoutType" character varying,
        "checkedOutAt" TIMESTAMP WITH TIME ZONE,
        "checkedOutById" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_55e31a0cae0fd6ab1a9f3c6b593" PRIMARY KEY ("id"),
        CONSTRAINT "FK_09ea275f3ccd7a71cbb68e12efe" FOREIGN KEY ("hotelId")
          REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_1e3065b7a51554ccccef825e0ef" FOREIGN KEY ("roomId")
          REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_8f233f6d5c636d8eb61b50bd7d5" FOREIGN KEY ("checkedOutById")
          REFERENCES "tenant_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    // 2. One active stay per room (race-safe check-in)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stays_room_active" ON "stays" ("roomId")
      WHERE "status" = 'active'
    `);

    // 3. Code uniqueness among a hotel's active stays + O(1) guest login lookup
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stays_hotel_code_active" ON "stays" ("hotelId", "codeHash")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_stays_hotel_status" ON "stays" ("hotelId", "status")
    `);

    // 4. Hotel-local checkout hour (13.4 AC2)
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "checkoutTime" character varying(5) NOT NULL DEFAULT '12:00'
    `);

    // 5. Seeded-role backfill (idempotent — append only missing keys). Grants
    //    by role NAME on non-system roles: custom roles sharing these names
    //    also gain the keys (recorded Epic 11 ruling).
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['stays.read','stays.checkin','stays.update','stays.checkout']
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
        AND NOT ("permissions" @> ARRAY['stays.read'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove(array_remove(array_remove(array_remove(
        "permissions", 'stays.read'), 'stays.checkin'), 'stays.update'), 'stays.checkout')
      WHERE "isSystem" = false AND "nameEn" IN ('Manager', 'Front Desk')
    `);
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "checkoutTime"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stays_hotel_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stays_hotel_code_active"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_stays_room_active"`);
    await queryRunner.query(`DROP TABLE "stays"`);
  }
}
