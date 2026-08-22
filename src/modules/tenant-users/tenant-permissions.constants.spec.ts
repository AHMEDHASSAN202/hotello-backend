import { TENANT_PERMISSION_CATALOG } from './tenant-permissions.constants';

describe('TENANT_PERMISSION_CATALOG', () => {
  it('AC (11.2 AC1) — catalog exposes rooms.read/create/update in a core (non-module) group', () => {
    const rooms = TENANT_PERMISSION_CATALOG.find((g) => g.group === 'rooms');
    expect(rooms?.module).toBeUndefined();
    expect(rooms?.permissions.map((p) => p.key)).toEqual([
      'rooms.read',
      'rooms.create',
      'rooms.update',
    ]);
  });

  it('Epic 15 — requests group is gated by the requests module and exposes the four keys', () => {
    const requests = TENANT_PERMISSION_CATALOG.find(
      (g) => g.group === 'requests',
    );
    expect(requests?.module).toBe('requests');
    expect(requests?.permissions.map((p) => p.key)).toEqual([
      'requests.read',
      'requests.update',
      'requests.assign',
      'request_catalog.manage',
    ]);
  });
});
