import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 09 — Stories 9.7 / 9.8: staff accounts created directly with a
 * username + temporary password, and manager-driven password resets.
 *
 * - `mustChangePassword` forces a password change on first login for
 *   directly-created and manager-reset accounts (9.7 AC4 / 9.8 AC1).
 * - A CHECK constraint guarantees every account keeps at least one login
 *   identifier — email, username, or both (9.7 AC3). Runs after
 *   TenantUsernameLogin added `username` and made `email` nullable.
 */
export class TenantStaffDirectAccounts1785700000000
  implements MigrationInterface
{
  name = 'TenantStaffDirectAccounts1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD "mustChangePassword" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD CONSTRAINT "CHK_tenant_users_identifier"
        CHECK ("email" IS NOT NULL OR "username" IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        DROP CONSTRAINT "CHK_tenant_users_identifier"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_users" DROP COLUMN "mustChangePassword"
    `);
  }
}
