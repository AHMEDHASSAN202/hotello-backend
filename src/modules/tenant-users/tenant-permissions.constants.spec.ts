import { ALL_MODULE_KEYS } from '../plans/modules.constants';
import { DEFAULT_TENANT_ROLES } from '../tenant-roles/default-tenant-roles';
import { TENANT_HINT_KEYS } from './tenant-hint-keys.constants';
import {
  ALL_TENANT_PERMISSION_KEYS,
  TENANT_PERMISSION_CATALOG,
} from './tenant-permissions.constants';

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

  it('Epic 16 — fnb group is gated by the fnb module and exposes the five keys', () => {
    const fnb = TENANT_PERMISSION_CATALOG.find((g) => g.group === 'fnb');
    expect(fnb?.module).toBe('fnb');
    expect(fnb?.permissions.map((p) => p.key)).toEqual([
      'fnb_menus.manage',
      'fnb_locations.manage',
      'fnb_orders.read',
      'fnb_orders.update',
      'fnb_settings.manage',
    ]);
  });

  it('Epic 17 — hotel_info group is gated by the hotel_info module and exposes hotel_info.manage', () => {
    const info = TENANT_PERMISSION_CATALOG.find((g) => g.group === 'hotel_info');
    expect(info?.module).toBe('hotel_info');
    expect(info?.permissions.map((p) => p.key)).toEqual(['hotel_info.manage']);
  });

  it('Epic 17 — hotel_info is a platform module key', () => {
    expect(ALL_MODULE_KEYS).toContain('hotel_info');
  });

  it('Epic 17 — hotelInfo.firstRun and the Epic 16 hint keys are registered', () => {
    for (const key of [
      'hotelInfo.firstRun',
      'fnb.firstRun',
      'fnb.locationsGuidance',
      'fnb.soundMuted',
    ]) {
      expect(TENANT_HINT_KEYS).toContain(key);
    }
  });

  it('permission keys are globally unique', () => {
    expect(new Set(ALL_TENANT_PERMISSION_KEYS).size).toBe(
      ALL_TENANT_PERMISSION_KEYS.length,
    );
  });
});

describe('DEFAULT_TENANT_ROLES (Epic 16 seeding)', () => {
  const byName = (name: string) =>
    DEFAULT_TENANT_ROLES.find((r) => r.nameEn === name);

  it('every seeded permission key exists in the catalog', () => {
    for (const role of DEFAULT_TENANT_ROLES) {
      for (const key of role.permissions) {
        if (key === '*') continue;
        expect(ALL_TENANT_PERMISSION_KEYS).toContain(key);
      }
    }
  });

  it('Manager gains all five fnb keys', () => {
    const manager = byName('Manager');
    for (const key of [
      'fnb_menus.manage',
      'fnb_locations.manage',
      'fnb_orders.read',
      'fnb_orders.update',
      'fnb_settings.manage',
    ]) {
      expect(manager?.permissions).toContain(key);
    }
  });

  it('Front Desk gains fnb_orders.read only', () => {
    const frontDesk = byName('Front Desk');
    expect(frontDesk?.permissions).toContain('fnb_orders.read');
    expect(frontDesk?.permissions).not.toContain('fnb_orders.update');
    expect(frontDesk?.permissions).not.toContain('fnb_menus.manage');
  });

  it('Epic 17 — Manager and Front Desk gain hotel_info.manage', () => {
    expect(byName('Manager')?.permissions).toContain('hotel_info.manage');
    expect(byName('Front Desk')?.permissions).toContain('hotel_info.manage');
    expect(byName('Housekeeping')?.permissions).not.toContain(
      'hotel_info.manage',
    );
  });

  it('seeds the F&B / Kitchen role (non-system) with board + menus access', () => {
    const kitchen = byName('F&B / Kitchen');
    expect(kitchen).toMatchObject({
      nameAr: 'الأغذية والمشروبات',
      isSystem: false,
    });
    expect(kitchen?.permissions).toEqual([
      'fnb_orders.read',
      'fnb_orders.update',
      'fnb_menus.manage',
    ]);
  });
});
