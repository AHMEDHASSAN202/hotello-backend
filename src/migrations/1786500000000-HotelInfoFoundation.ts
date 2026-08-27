import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 17 — Hotel Info / Directory foundation.
 *
 * 1 — hotel_info_entries: one table typed by `section` (spec note 1 — five
 *     fixed section types, no over-normalization). 7-locale JSONB
 *     names/descriptions, per-section `structured` payload (essentials
 *     wifi/phones, facility hours windows + location note, service
 *     how-to/price note), `photos` array (facility photo max 1, About
 *     gallery max 8 — enforced in the service).
 * 2 — permission backfill for existing hotels' default roles (grants by
 *     role name on non-system roles; recorded Epic 11 ruling): Manager and
 *     Front Desk get hotel_info.manage (spec header — front desk knows the
 *     practical answers guests ask).
 * 3 — plans backfill: every existing plan gains the `hotel_info` module
 *     (seeded plans enable all modules; a super admin can remove it per
 *     plan — recorded Epic 17 decision).
 *
 * FK/PK constraint names are TypeORM's own hashes (harvested via a throwaway
 * `migration:generate`) so `npm run migration:check` reports no drift.
 */
export class HotelInfoFoundation1786500000000 implements MigrationInterface {
  name = 'HotelInfoFoundation1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — the directory table
    await queryRunner.query(
      `CREATE TABLE "hotel_info_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "section" character varying(20) NOT NULL, "names" jsonb NOT NULL DEFAULT '{}', "descriptions" jsonb, "structured" jsonb NOT NULL DEFAULT '{}', "photos" jsonb NOT NULL DEFAULT '[]', "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4cb89a528cf0331d6006226abbf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hotel_info_entries_hotel_section" ON "hotel_info_entries" ("hotelId", "section") `,
    );
    await queryRunner.query(
      `ALTER TABLE "hotel_info_entries" ADD CONSTRAINT "FK_c6605cfd859e2caa2caa3b33de9" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // 2 — permission backfill for existing hotels' default roles
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['hotel_info.manage']
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
        AND NOT ("permissions" @> ARRAY['hotel_info.manage'])
    `);

    // 3 — enable the module on every existing plan
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_append("enabledModules", 'hotel_info')
      WHERE NOT ("enabledModules" @> ARRAY['hotel_info'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 3/2 — reverse plan enablement and permission grants first.
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_remove("enabledModules", 'hotel_info')
    `);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'hotel_info.manage')
      WHERE "isSystem" = false
        AND "nameEn" IN ('Manager', 'Front Desk')
    `);

    await queryRunner.query(
      `ALTER TABLE "hotel_info_entries" DROP CONSTRAINT "FK_c6605cfd859e2caa2caa3b33de9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_hotel_info_entries_hotel_section"`,
    );
    await queryRunner.query(`DROP TABLE "hotel_info_entries"`);
  }
}
