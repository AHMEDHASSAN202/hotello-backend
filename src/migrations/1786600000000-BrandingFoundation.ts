import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 18 — Guest App Branding.
 * Cover image keys + welcome message on hotels; Manager gains branding.manage.
 * Deliberately does NOT add guest_app_branding to existing plans — it is the
 * upsell module (plans opt in via the Super Admin plan editor).
 */
export class BrandingFoundation1786600000000 implements MigrationInterface {
  name = 'BrandingFoundation1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hotels" ADD "coverImageThumbKey" text`);
    await queryRunner.query(`ALTER TABLE "hotels" ADD "coverImageDetailKey" text`);
    await queryRunner.query(`ALTER TABLE "hotels" ADD "welcomeMessage" jsonb`);
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = "permissions" || ARRAY['branding.manage']
      WHERE "isSystem" = false
        AND "nameEn" = 'Manager'
        AND NOT ("permissions" @> ARRAY['branding.manage'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_roles"
      SET "permissions" = array_remove("permissions", 'branding.manage')
      WHERE "isSystem" = false AND "nameEn" = 'Manager'
    `);
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "welcomeMessage"`);
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "coverImageDetailKey"`);
    await queryRunner.query(`ALTER TABLE "hotels" DROP COLUMN "coverImageThumbKey"`);
  }
}
