import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 21 — Story 21.3 groundwork. Adds two nullable columns to the
 * already-shipped (Epic 19) `announcements` table so the Events module can
 * later (Task 6) auto-generate publish/cancel notices that the tenant UI
 * badges "auto · event":
 *
 * - `source`: null = manually composed by a tenant user (every existing
 *   row); `'event_publish' | 'event_cancel'` when Events created the row.
 * - `eventId`: FKs into `events` (Task 3's `EventsFoundation` migration,
 *   which this migration sorts after), `ON DELETE SET NULL` — an event being
 *   removed must never delete announcement history (repo "no hard deletes"
 *   precedent, mirrors `infoEntryId` on this same table).
 *
 * Purely additive/nullable — no backfill needed, existing persisted rows are
 * unaffected. FK constraint name is TypeORM's own hash (harvested via a
 * throwaway `migration:generate`) so `npm run migration:check` reports no
 * drift.
 */
export class AnnouncementEventChip1787100000000
  implements MigrationInterface
{
  name = 'AnnouncementEventChip1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "source" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "eventId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD CONSTRAINT "FK_7843288a6f12124a0d0c607cc4c" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP CONSTRAINT "FK_7843288a6f12124a0d0c607cc4c"`,
    );
    await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN "eventId"`);
    await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN "source"`);
  }
}
