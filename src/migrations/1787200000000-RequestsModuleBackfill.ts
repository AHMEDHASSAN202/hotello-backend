import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * QA-14-001 — plans created before Epic 14/15 predate the `requests` module
 * key, and the seed is find-or-create (never refreshes `enabledModules`), so
 * the whole Requests module stayed locked for hotels on the seeded launch
 * plans: no guest tile, guest catalog and tenant board both 403
 * MODULE_NOT_ENABLED.
 *
 * RequestsFoundation shipped the role-permission backfill but missed the
 * plans half; every later module epic (hotel_info, announcements,
 * housekeeping, events) shipped both. This closes the gap with the same
 * pattern: enable on every existing plan; a super admin can still remove it
 * per plan afterwards (recorded Epic 17 decision).
 */
export class RequestsModuleBackfill1787200000000 implements MigrationInterface {
  name = 'RequestsModuleBackfill1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_append("enabledModules", 'requests')
      WHERE NOT ("enabledModules" @> ARRAY['requests'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_remove("enabledModules", 'requests')
    `);
  }
}
