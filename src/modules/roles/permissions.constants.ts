/**
 * The single source of truth for permission keys.
 * Exposed via GET /roles/permissions/catalog — the frontend never hardcodes keys.
 * Adding a module = adding its keys here; the roles UI picks them up automatically.
 */
export const WILDCARD = '*';

export const PERMISSION_CATALOG: Record<string, string[]> = {
  admins: ['admins.read', 'admins.create', 'admins.update', 'admins.delete'],
  roles: ['roles.read', 'roles.create', 'roles.update', 'roles.delete'],
  plans: ['plans.read', 'plans.create', 'plans.update', 'plans.archive'],
  subscriptions: ['subscriptions.read', 'subscriptions.update'],
  hotels: ['hotels.read', 'hotels.create', 'hotels.update', 'hotels.suspend'],
  notifications: ['notifications.read', 'notifications.resend'],
};

export const ALL_PERMISSION_KEYS: string[] =
  Object.values(PERMISSION_CATALOG).flat();
