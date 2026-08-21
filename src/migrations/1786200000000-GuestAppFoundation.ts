import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guest App foundation (Epic 14). Adds the optional per-hotel accent color for
 * the guest PWA (Story 14.4 AC5) — applied only when the plan includes the
 * `guest_app_branding` module. Nullable: null means the GXP default accent;
 * values arrive later via the future branding-customization UI.
 */
export class GuestAppFoundation1786200000000 implements MigrationInterface {
  name = 'GuestAppFoundation1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "brandAccentColor" character varying(7)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hotels" DROP COLUMN "brandAccentColor"
    `);
  }
}
