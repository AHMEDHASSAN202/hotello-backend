import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 20 — Housekeeping Operations foundation.
 *
 * 1 — `rooms` gains the cleanliness axis (20.1 AC1): current-state-only
 *     columns, history lives in audit. The DND/assignee/last-cleaned refs are
 *     plain uuids on purpose (no FKs) — stays and tenant_users are permanent
 *     records and the board batch-loads names instead of joining.
 *     `lastDailyFlaggedOn` is the per-room per-day idempotency key of the
 *     daily job (20.1 AC4, note 4).
 * 2 — `hotels.dailyServiceTime` beside `checkoutTime` (20.1 AC4).
 * 3 — roles backfill (grant-by-nameEn on non-system roles, the recorded
 *     Epic 11 ruling): Manager gains read/update/assign, Housekeeping gains
 *     read/update, Front Desk gains read.
 * 4 — plans backfill: every existing plan gains the `housekeeping` module
 *     (default-on, the Epic 17/19 form — the module key has been in the
 *     catalog since Epic 04).
 */
export class HousekeepingFoundation1786800000000 implements MigrationInterface {
  name = 'HousekeepingFoundation1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — rooms: the cleanliness axis
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "housekeepingStatus" character varying(16) NOT NULL DEFAULT 'clean'`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "cleaningType" character varying(10)`,
    );
    await queryRunner.query(`ALTER TABLE "rooms" ADD "dndSetByStayId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "housekeepingAssignedToId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "lastCleanedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "rooms" ADD "lastCleanedById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD "lastDailyFlaggedOn" date`,
    );

    // 2 — hotels: daily service hour
    await queryRunner.query(
      `ALTER TABLE "hotels" ADD "dailyServiceTime" character varying(5) NOT NULL DEFAULT '09:00'`,
    );

    // 3 — role grants for existing hotels (one UPDATE per key per role set so
    // partially-granted roles converge instead of duplicating)
    for (const [key, roles] of [
      ['housekeeping.read', `'Manager', 'Housekeeping', 'Front Desk'`],
      ['housekeeping.update', `'Manager', 'Housekeeping'`],
      ['housekeeping.assign', `'Manager'`],
    ] as const) {
      await queryRunner.query(`
        UPDATE "tenant_roles"
        SET "permissions" = "permissions" || ARRAY['${key}']
        WHERE "isSystem" = false
          AND "nameEn" IN (${roles})
          AND NOT ("permissions" @> ARRAY['${key}'])
      `);
    }

    // 4 — enable the module on every existing plan
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_append("enabledModules", 'housekeeping')
      WHERE NOT ("enabledModules" @> ARRAY['housekeeping'])
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 4/3 — reverse plan enablement and permission grants first.
    await queryRunner.query(`
      UPDATE "plans"
      SET "enabledModules" = array_remove("enabledModules", 'housekeeping')
    `);
    for (const key of [
      'housekeeping.assign',
      'housekeeping.update',
      'housekeeping.read',
    ]) {
      await queryRunner.query(`
        UPDATE "tenant_roles"
        SET "permissions" = array_remove("permissions", '${key}')
        WHERE "isSystem" = false
      `);
    }

    // 2/1 — drop the added columns.
    await queryRunner.query(
      `ALTER TABLE "hotels" DROP COLUMN "dailyServiceTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP COLUMN "lastDailyFlaggedOn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP COLUMN "lastCleanedById"`,
    );
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN "lastCleanedAt"`);
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP COLUMN "housekeepingAssignedToId"`,
    );
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN "dndSetByStayId"`);
    await queryRunner.query(`ALTER TABLE "rooms" DROP COLUMN "cleaningType"`);
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP COLUMN "housekeepingStatus"`,
    );
  }
}
