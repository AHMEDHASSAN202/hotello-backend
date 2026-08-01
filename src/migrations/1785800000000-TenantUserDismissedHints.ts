import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 12 — Story 12.4 AC2: per-user dismissal of first-run HintCards,
 * persisted server-side so it survives devices and browsers. A jsonb string
 * array (like NotificationOutbox.attempts) — values are constrained to the
 * code-side TENANT_HINT_KEYS allowlist by the dismiss endpoint, so the column
 * stays tiny and needs no join table.
 */
export class TenantUserDismissedHints1785800000000
  implements MigrationInterface
{
  name = 'TenantUserDismissedHints1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users"
        ADD "dismissedHints" jsonb NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_users" DROP COLUMN "dismissedHints"
    `);
  }
}
