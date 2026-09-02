/**
 * Thin SQL escape hatch for the two things E2E cannot assert over HTTP:
 *  - audit rows (the API has no audit read endpoint — write-only by design)
 *  - test-data cleanup (QA hotels have no delete API; removal is DB-side,
 *    scoped strictly to rows this suite created — slugs start `qa-`).
 * This touches DATA, never application code.
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.GXP_DB_CONTAINER ?? 'hotello-db';
const DB_USER = process.env.GXP_DB_USER ?? 'hotello';
const DB_NAME = process.env.GXP_DB_NAME ?? 'hotello';

export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc', query],
    { encoding: 'utf8', timeout: 30_000 },
  ).trim();
}

/**
 * Audit rows whose metadata carries the hotel id (entity-scoped actions like
 * room.created point entityId at the ROOM, with hotelId only in metadata).
 */
export function auditCountByMeta(action: string, hotelId: string): number {
  const out = sql(
    `SELECT count(*) FROM audit_logs WHERE action = '${action}' AND metadata->>'hotelId' = '${hotelId}'`,
  );
  return Number(out);
}

/** Latest metadata for an action scoped by metadata->>'hotelId'. */
export function lastAuditMetaByMeta(action: string, hotelId: string): string | null {
  const out = sql(
    `SELECT metadata FROM audit_logs WHERE action = '${action}' AND metadata->>'hotelId' = '${hotelId}' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  return out === '' ? null : out;
}

/** audit_logs row count for an action whose entityId IS the hotel. */
export function auditCount(action: string, hotelId: string): number {
  const out = sql(
    `SELECT count(*) FROM audit_logs WHERE action = '${action}' AND "entityId" = '${hotelId}'`,
  );
  return Number(out);
}

/** Fetch the metadata JSON of the latest matching audit row (or null). */
export function lastAuditMeta(action: string, hotelId: string): string | null {
  const out = sql(
    `SELECT metadata FROM audit_logs WHERE action = '${action}' AND "entityId" = '${hotelId}' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  return out === '' ? null : out;
}

/**
 * Delete QA hotels whose slug starts with `prefix`, in FK dependency order.
 * Parallel agents scope their cleanup with GXP_CLEANUP_PREFIX (e.g.
 * `qa-e16-`) so one agent's teardown never wipes another's in-flight data.
 * The prefix is stripped to safe characters before interpolation.
 */
export function deleteQaHotels(prefix = process.env.GXP_CLEANUP_PREFIX ?? 'qa-'): void {
  const safe = prefix.replace(/[^a-z0-9-]/gi, '');
  const like = `${safe}%`;
  const hotelIds = `SELECT id FROM hotels WHERE slug LIKE '${like}'`;

  const orderedDeletes = [
    `DELETE FROM fnb_order_lines WHERE "orderId" IN (SELECT id FROM fnb_orders WHERE "hotelId" IN (${hotelIds}))`,
    `DELETE FROM fnb_orders WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM fnb_menu_sections WHERE "menuId" IN (SELECT id FROM fnb_menus WHERE "hotelId" IN (${hotelIds}))`,
    `DELETE FROM fnb_menus WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM fnb_locations WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM fnb_items WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM event_bookings WHERE "eventId" IN (SELECT id FROM events WHERE "hotelId" IN (${hotelIds}))`,
    `DELETE FROM events WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM announcement_reads WHERE "announcementId" IN (SELECT id FROM announcements WHERE "hotelId" IN (${hotelIds}))`,
    `DELETE FROM announcements WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM hotel_info_entries WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM requests WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM hotel_request_item_settings WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM hotel_request_category_settings WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM stays WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM rooms WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM room_types WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM tenant_users WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM tenant_roles WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM subscriptions WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM notification_outbox WHERE "hotelId" IN (${hotelIds})`,
    `DELETE FROM audit_logs WHERE "entityId" IN (${hotelIds})`,
    `DELETE FROM hotels WHERE slug LIKE '${like}'`,
  ];
  for (const q of orderedDeletes) {
    try {
      sql(q);
    } catch {
      // Table might not exist yet on a fresh schema — QA deletes are best
      // effort; real cleanup for a given epic covers the tables it uses.
    }
  }
}
