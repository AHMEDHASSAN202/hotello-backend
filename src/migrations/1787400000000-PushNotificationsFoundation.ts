import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 23 — Push Notifications foundation.
 *
 * 1 — `push_subscriptions`: one row per device endpoint, bound to a stay
 *     (multiple devices per stay — the family-phones rule, 23.1 AC1).
 *     Unique endpoint makes subscribe idempotent.
 * 2 — `push_dispatches`: the push outbox. Deliberately NOT the email
 *     notification_outbox (spec note 2): short TTLs, collapse topics,
 *     quiet-hold, and 30-day retention don't fit the email audit trail.
 * 3 — `announcements.sendPush`: the composer toggle (23.3 AC1), stored on
 *     the row so send-from-list and the scheduler cron keep the intent.
 *
 * No FKs — subscriptions/dispatches reference stays/hotels by id only,
 * matching the outbox's loose-coupling style (dispatch pruning must not be
 * blocked by stay rows). PK/index names are TypeORM's own hashes, harvested
 * via `npm run migration:check` after the entities landed, so the check
 * reports no drift.
 */
export class PushNotificationsFoundation1787400000000
  implements MigrationInterface
{
  name = 'PushNotificationsFoundation1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1 — push_subscriptions
    await queryRunner.query(
      `CREATE TABLE "push_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "stayId" uuid NOT NULL, "endpoint" text NOT NULL, "p256dh" text NOT NULL, "auth" text NOT NULL, "deviceHint" character varying(20), "failureCount" integer NOT NULL DEFAULT '0', "lastSuccessAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_757fc8f00c34f66832668dc2e53" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0008bdfd174e533a3f98bf9af1" ON "push_subscriptions" ("endpoint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d84c8a4eb5e63ea65b67634ccd" ON "push_subscriptions" ("hotelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d22a9ee858fda843573003450f" ON "push_subscriptions" ("stayId") `,
    );

    // 2 — push_dispatches
    await queryRunner.query(
      `CREATE TABLE "push_dispatches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hotelId" uuid NOT NULL, "stayId" uuid NOT NULL, "subscriptionId" uuid NOT NULL, "type" character varying(20) NOT NULL, "refId" uuid, "title" text NOT NULL, "body" text NOT NULL, "url" text NOT NULL, "ttlSeconds" integer NOT NULL, "topic" character varying(32), "dedupeKey" text, "status" character varying NOT NULL DEFAULT 'pending', "deliverAfter" TIMESTAMP WITH TIME ZONE, "attemptCount" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "attempts" jsonb NOT NULL DEFAULT '[]', "sentAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_439e3013676eeb95129d7cf525f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ba0b72911524d0bd47c4a2087e" ON "push_dispatches" ("dedupeKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56d88d4e96d78c17edf3790083" ON "push_dispatches" ("refId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e18ede16a04916337a960109a1" ON "push_dispatches" ("hotelId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32043699e6dcf80d4d67629e30" ON "push_dispatches" ("status", "nextAttemptAt") `,
    );

    // 3 — announcements.sendPush
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "sendPush" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 3 — announcements.sendPush
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP COLUMN "sendPush"`,
    );

    // 2 — push_dispatches
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32043699e6dcf80d4d67629e30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e18ede16a04916337a960109a1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56d88d4e96d78c17edf3790083"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba0b72911524d0bd47c4a2087e"`,
    );
    await queryRunner.query(`DROP TABLE "push_dispatches"`);

    // 1 — push_subscriptions
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d22a9ee858fda843573003450f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d84c8a4eb5e63ea65b67634ccd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0008bdfd174e533a3f98bf9af1"`,
    );
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
