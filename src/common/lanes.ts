/**
 * Epic 26 (26.2) — the two-lane task model, server-side. The PWA never
 * client-filters assignment: list endpoints accept `assignee` and return
 * rows stamped with their lane; in delta mode, rows that changed but no
 * longer belong to a requested lane come back as reasoned tombstones so the
 * client can slide them out with the right one-line toast (26.2 AC2 /
 * 26.3 AC5). Feed-specific lane rules live in each service; this file is
 * the shared mechanics.
 */
export const ASSIGNEE_FILTERS = ['me', 'unassigned', 'me,unassigned'] as const;
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export type Lane = 'mine' | 'available';

/** Why a row left the caller's lanes (drives the PWA's toast). */
export type LaneTombstoneReason = 'taken' | 'closed' | 'cancelled' | 'removed';

export interface LaneTombstone {
  id: string;
  active: false;
  reason: LaneTombstoneReason;
}

export type Laned<T> = T & { lane: Lane };

export function requestedLanes(filter: AssigneeFilter): ReadonlySet<Lane> {
  const lanes = new Set<Lane>();
  for (const part of filter.split(',')) {
    if (part === 'me') lanes.add('mine');
    if (part === 'unassigned') lanes.add('available');
  }
  return lanes;
}

export function applyLaneFilter<T extends { id: string }>(
  rows: T[],
  lanes: ReadonlySet<Lane>,
  laneOf: (row: T) => Lane | null,
  reasonOf: (row: T) => LaneTombstoneReason,
  mode: 'full' | 'delta',
): Array<Laned<T> | LaneTombstone> {
  const out: Array<Laned<T> | LaneTombstone> = [];
  for (const row of rows) {
    const lane = laneOf(row);
    if (lane && lanes.has(lane)) {
      out.push({ ...row, lane });
    } else if (mode === 'delta') {
      out.push({ id: row.id, active: false, reason: reasonOf(row) });
    }
  }
  return out;
}
