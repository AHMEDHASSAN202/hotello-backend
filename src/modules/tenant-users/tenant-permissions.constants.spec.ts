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
});
