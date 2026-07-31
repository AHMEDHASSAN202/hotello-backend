import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 08 — Story 8.3 AC1 / 8.4 AC5: tenant users can sign in with an email OR
 * a username. Staff accounts (Epic 09) may have a username and no email.
 *
 * - `username` is added (nullable) and made unique per hotel. Postgres treats
 *   NULLs as distinct, so the many owner rows with a null username don't clash.
 * - `email` becomes nullable so email-less username accounts are representable.
 *
 * The "at least one identifier" CHECK lives in the follow-on
 * TenantStaffDirectAccounts migration (it's meaningful only once accounts can
 * be created without an email, in Epic 09).
 */
export class TenantUsernameLogin1785600000000 implements MigrationInterface {
  name = 'TenantUsernameLogin1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ALTER COLUMN "email" DROP NOT NULL,
        ADD "username" text
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD CONSTRAINT "UQ_tenant_users_hotel_username" UNIQUE ("hotelId", "username")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP CONSTRAINT "UQ_tenant_users_hotel_username"
    `);
    // Reversible only when no email-less rows exist (username accounts are Epic 09).
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP COLUMN "username",
        ALTER COLUMN "email" SET NOT NULL
    `);
  }
}
