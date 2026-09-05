import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 26, Story 26.4 AC1 — staff push storage.
 *
 * Makes the Epic 23 push tables' owning binding polymorphic: `stayId` XOR
 * `tenantUserId` (a device belongs to exactly one of a guest stay or a
 * tenant/staff user, never both, never neither). `stayId` loses its
 * NOT NULL and both tables gain a nullable `tenantUserId` + a CHECK
 * constraint enforcing the XOR, plus an index for the new lookup path
 * (`findByTenantUserIds`, the staff-fan-out gate in `attemptSend`).
 *
 * Index hash names harvested via `npm run migration:generate` against the
 * entity change (a throwaway migration, deleted after copying the names
 * here) so `npm run migration:check` reports no drift.
 */
export class StaffPush1787500000000 implements MigrationInterface {
  name = 'StaffPush1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // push_subscriptions
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ALTER COLUMN "stayId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD "tenantUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD CONSTRAINT "CHK_push_subscriptions_owner" CHECK (("stayId" IS NULL) <> ("tenantUserId" IS NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9324fdb2c7b5de5cead0e919d" ON "push_subscriptions" ("tenantUserId") `,
    );

    // push_dispatches
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" ALTER COLUMN "stayId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" ADD "tenantUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" ADD CONSTRAINT "CHK_push_dispatches_owner" CHECK (("stayId" IS NULL) <> ("tenantUserId" IS NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5af49da33a5900741413d9fd83" ON "push_dispatches" ("tenantUserId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // push_dispatches
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5af49da33a5900741413d9fd83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" DROP CONSTRAINT "CHK_push_dispatches_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" DROP COLUMN "tenantUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_dispatches" ALTER COLUMN "stayId" SET NOT NULL`,
    );

    // push_subscriptions
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9324fdb2c7b5de5cead0e919d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP CONSTRAINT "CHK_push_subscriptions_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP COLUMN "tenantUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ALTER COLUMN "stayId" SET NOT NULL`,
    );
  }
}
