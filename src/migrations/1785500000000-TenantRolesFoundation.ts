import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 09 — tenant roles data layer (Story 9.1).
 *
 * - Creates `tenant_roles` (per-hotel roles, unique name per language, system
 *   flag) and backfills the four default roles into every existing hotel.
 * - Moves tenant-user permissions to resolve **through a role** (spec note #1):
 *   adds `tenant_users.roleId` (FK), links each existing owner to their hotel's
 *   seeded Owner role, then drops the now-redundant `role` string and
 *   `permissions` jsonb columns.
 * - Adds `tenant_users.inviteSentAt` for the resend cooldown (Story 9.6 AC2).
 */
export class TenantRolesFoundation1785500000000 implements MigrationInterface {
  name = 'TenantRolesFoundation1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenant_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hotelId" uuid NOT NULL,
        "nameEn" character varying NOT NULL,
        "nameAr" character varying NOT NULL,
        "descriptionEn" text,
        "descriptionAr" text,
        "permissions" text array NOT NULL DEFAULT '{}',
        "isSystem" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_roles_hotel_name_en" UNIQUE ("hotelId", "nameEn"),
        CONSTRAINT "UQ_tenant_roles_hotel_name_ar" UNIQUE ("hotelId", "nameAr"),
        CONSTRAINT "PK_tenant_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_afc745379dd4dc4c23b2193829e" FOREIGN KEY ("hotelId")
          REFERENCES "hotels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);

    // Story 9.1 AC2 — backfill the four defaults for every existing hotel
    // (idempotent via NOT EXISTS). One INSERT per role keeps the text[] typing
    // clean and mirrors DEFAULT_TENANT_ROLES.
    const defaults: Array<{
      nameEn: string;
      nameAr: string;
      descriptionEn: string;
      descriptionAr: string;
      permissions: string;
      isSystem: boolean;
    }> = [
      {
        nameEn: 'Owner',
        nameAr: 'المالك',
        descriptionEn: 'Full access to everything in the hotel dashboard.',
        descriptionAr: 'صلاحية كاملة على كل شيء في لوحة تحكم الفندق.',
        permissions: `ARRAY['*']::text[]`,
        isSystem: true,
      },
      {
        nameEn: 'Manager',
        nameAr: 'المدير',
        descriptionEn: 'Manages staff and day-to-day operations.',
        descriptionAr: 'يدير الموظفين والعمليات اليومية.',
        permissions: `ARRAY['staff.read','staff.invite','staff.update','staff.disable','roles.read']::text[]`,
        isSystem: false,
      },
      {
        nameEn: 'Front Desk',
        nameAr: 'موظف الاستقبال',
        descriptionEn: 'Handles front-desk guest operations.',
        descriptionAr: 'يتولى عمليات الاستقبال والنزلاء.',
        permissions: `ARRAY[]::text[]`,
        isSystem: false,
      },
      {
        nameEn: 'Housekeeping',
        nameAr: 'التدبير الفندقي',
        descriptionEn: 'Handles housekeeping operations.',
        descriptionAr: 'يتولى عمليات التدبير الفندقي.',
        permissions: `ARRAY[]::text[]`,
        isSystem: false,
      },
    ];
    for (const def of defaults) {
      await queryRunner.query(
        `
        INSERT INTO "tenant_roles"
          ("hotelId", "nameEn", "nameAr", "descriptionEn", "descriptionAr", "permissions", "isSystem")
        SELECT h."id", $1::text, $2::text, $3::text, $4::text, ${def.permissions}, $5::boolean
        FROM "hotels" h
        WHERE NOT EXISTS (
          SELECT 1 FROM "tenant_roles" r
          WHERE r."hotelId" = h."id" AND r."nameEn" = $1::text
        )
        `,
        [def.nameEn, def.nameAr, def.descriptionEn, def.descriptionAr, def.isSystem],
      );
    }

    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD "roleId" uuid,
        ADD "inviteSentAt" TIMESTAMP WITH TIME ZONE
    `);

    // Every pre-Epic-09 tenant user is an owner → link to the seeded Owner role.
    await queryRunner.query(`
      UPDATE "tenant_users" u
      SET "roleId" = r."id"
      FROM "tenant_roles" r
      WHERE r."hotelId" = u."hotelId"
        AND r."isSystem" = true
        AND u."role" = 'owner'
    `);
    // Safety net for any non-owner rows (none expected): fall back to Manager.
    await queryRunner.query(`
      UPDATE "tenant_users" u
      SET "roleId" = r."id"
      FROM "tenant_roles" r
      WHERE r."hotelId" = u."hotelId"
        AND r."nameEn" = 'Manager'
        AND u."roleId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "tenant_users" ALTER COLUMN "roleId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD CONSTRAINT "FK_21635971249080ad8ca2479c9e5" FOREIGN KEY ("roleId")
          REFERENCES "tenant_roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP COLUMN "role",
        DROP COLUMN "permissions"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD "role" character varying NOT NULL DEFAULT 'owner',
        ADD "permissions" jsonb NOT NULL DEFAULT '["*"]'
    `);
    // Best-effort restore: system-role holders were the owners; carry each
    // user's role permissions back onto the per-user column.
    await queryRunner.query(`
      UPDATE "tenant_users" u
      SET "role" = CASE WHEN r."isSystem" THEN 'owner' ELSE lower(r."nameEn") END,
          "permissions" = to_jsonb(r."permissions")
      FROM "tenant_roles" r
      WHERE r."id" = u."roleId"
    `);

    await queryRunner.query(`
      ALTER TABLE "tenant_users" DROP CONSTRAINT "FK_21635971249080ad8ca2479c9e5"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP COLUMN "inviteSentAt",
        DROP COLUMN "roleId"
    `);
    await queryRunner.query(`DROP TABLE "tenant_roles"`);
  }
}
