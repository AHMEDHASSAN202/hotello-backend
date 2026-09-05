import { applyLaneFilter, requestedLanes } from './lanes';

type Row = { id: string; owner: string | null; status: 'open' | 'done' | 'cancelled' };
const ME = 'u1';
const laneOf = (r: Row) =>
  r.status !== 'open' ? null : r.owner === ME ? 'mine' : r.owner === null ? 'available' : null;
const reasonOf = (r: Row) =>
  r.status === 'cancelled' ? 'cancelled' : r.status === 'done' ? 'closed' : 'taken';

describe('lanes (26.2 AC1/AC3)', () => {
  const rows: Row[] = [
    { id: 'a', owner: ME, status: 'open' },
    { id: 'b', owner: null, status: 'open' },
    { id: 'c', owner: 'u2', status: 'open' },
    { id: 'd', owner: ME, status: 'done' },
    { id: 'e', owner: null, status: 'cancelled' },
  ];

  it('requestedLanes parses the three filters', () => {
    expect([...requestedLanes('me')]).toEqual(['mine']);
    expect([...requestedLanes('unassigned')]).toEqual(['available']);
    expect([...requestedLanes('me,unassigned')].sort()).toEqual(['available', 'mine']);
  });

  it('full mode keeps only in-lane rows, stamped with their lane', () => {
    const out = applyLaneFilter(rows, requestedLanes('me,unassigned'), laneOf, reasonOf, 'full');
    expect(out).toEqual([
      { id: 'a', owner: ME, status: 'open', lane: 'mine' },
      { id: 'b', owner: null, status: 'open', lane: 'available' },
    ]);
  });

  it('full mode with assignee=me never returns the available lane', () => {
    const out = applyLaneFilter(rows, requestedLanes('me'), laneOf, reasonOf, 'full');
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it("delta mode tombstones rows that left the requested lanes (someone else's → taken)", () => {
    const out = applyLaneFilter(rows, requestedLanes('me,unassigned'), laneOf, reasonOf, 'delta');
    expect(out).toEqual([
      { id: 'a', owner: ME, status: 'open', lane: 'mine' },
      { id: 'b', owner: null, status: 'open', lane: 'available' },
      { id: 'c', active: false, reason: 'taken' },
      { id: 'd', active: false, reason: 'closed' },
      { id: 'e', active: false, reason: 'cancelled' },
    ]);
  });
});
