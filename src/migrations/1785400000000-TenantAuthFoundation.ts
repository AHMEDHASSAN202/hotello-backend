import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 08 — Tenant Dashboard auth foundation.
 *
 * - Email uniqueness moves from global to per-hotel (Story 8.3 AC1): the same
 *   email at another hotel is a distinct account.
 * - Adds the tenant user's own language preference (8.7), a rotating refresh
 *   token hash (8.5), and single-use password-reset token fields (8.4).
 */
export class TenantAuthFoundation1785400000000 implements MigrationInterface {
  name = 'TenantAuthFoundation1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP CONSTRAINT "UQ_fae37b5b2b62cbce0f173e77bd1"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD "preferredLanguage" text,
        ADD "refreshTokenHash" text,
        ADD "resetTokenHash" text,
        ADD "resetTokenExpiresAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD CONSTRAINT "UQ_tenant_users_hotel_email" UNIQUE ("hotelId", "email")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP CONSTRAINT "UQ_tenant_users_hotel_email"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP COLUMN "resetTokenExpiresAt",
        DROP COLUMN "resetTokenHash",
        DROP COLUMN "refreshTokenHash",
        DROP COLUMN "preferredLanguage"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD CONSTRAINT "UQ_fae37b5b2b62cbce0f173e77bd1" UNIQUE ("email")
    `);
  }
}
