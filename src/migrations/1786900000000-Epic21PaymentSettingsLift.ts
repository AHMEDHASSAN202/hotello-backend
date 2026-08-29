import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 21, Story 21.1 AC2 — payment-methods config lift.
 *
 * `hotels.fnbRoomChargeEnabled` (Epic 16, 16.4 AC1) is renamed to
 * `roomChargeEnabled`: a plain rename, not a data migration — there was
 * never a separate `fnb_settings` table, just this one boolean column (cash
 * is hardcoded `true`, never persisted). The column now reads as explicit
 * hotel-level payment config so Events (a later Epic 21 task) can read the
 * same toggle without an F&B-specific name. No constraint/index touches
 * this column, so the rename is the whole migration.
 */
export class Epic21PaymentSettingsLift1786900000000
  implements MigrationInterface
{
  name = 'Epic21PaymentSettingsLift1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hotels" RENAME COLUMN "fnbRoomChargeEnabled" TO "roomChargeEnabled"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hotels" RENAME COLUMN "roomChargeEnabled" TO "fnbRoomChargeEnabled"`,
    );
  }
}
