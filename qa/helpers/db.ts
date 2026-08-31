/**
 * Thin SQL escape hatch for the two things E2E cannot assert over HTTP:
 *  - audit rows (the API has no audit read endpoint — write-only by design)
 *  - test-data cleanup (QA hotels have no delete API; removal is DB-side,
 *    scoped strictly to rows this suite created — every slug starts `qa-`).
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

/** audit_logs row count for an action on a hotel's entities (actor-agnostic). */
export function auditCount(action: string, hotelId: string): number {
  const out = sql(
    `SELECT count(*) FROM audit_logs WHERE action = '${action}' AND "entityId" = '${hotelId}'`,
  );
  return Number(out);
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

/** Fetch the metadata JSON of the latest matching audit row (or null). */
export function lastAuditMeta(action: string, hotelId: string): string | null {
  const out = sql(
    `SELECT metadata FROM audit_logs WHERE action = '${action}' AND "entityId" = '${hotelId}' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  return out === '' ? null : out;
}

/**
 * Delete every QA hotel this suite ever created (slug prefix `qa-`), in FK
 * dependency order. Never touches real hotels — the prefix is reserved for
 * this suite.
 */
export function deleteQaHotels(): void {
  const orderedDeletes = [
    'DELETE FROM fnb_order_lines WHERE "orderId" IN (SELECT id FROM fnb_orders WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\'))',
    'DELETE FROM fnb_orders WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM fnb_menu_sections WHERE "menuId" IN (SELECT id FROM fnb_menus WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\'))',
    'DELETE FROM fnb_menus WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM fnb_locations WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM fnb_items WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM event_bookings WHERE "eventId" IN (SELECT id FROM events WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\'))',
    'DELETE FROM events WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM announcement_reads WHERE "announcementId" IN (SELECT id FROM announcements WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\'))',
    'DELETE FROM announcements WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM hotel_info_entries WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM requests WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM hotel_request_item_settings WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM hotel_request_category_settings WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM stays WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM rooms WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM room_types WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM tenant_users WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM tenant_roles WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM subscriptions WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM notification_outbox WHERE "hotelId" IN (SELECT id FROM hotels WHERE slug LIKE \'qa-%\')',
    'DELETE FROM hotels WHERE slug LIKE \'qa-%\'',
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
