> **Legacy combined spec for Epics 01–03 (predates the per-epic format). The copy in `specs/` is the canonical one.**

# User Stories — Super Admin Dashboard
**Module:** Platform Administration (Authentication, Admins, Roles & Permissions)
**Version:** 1.0 | **Date:** July 2026
**Stack:** NestJS (single backend project) + Next.js (admin dashboard frontend) + PostgreSQL

---

## Conventions

- **Story ID format:** `SA-<epic>-<number>` (SA = Super Admin)
- Every story includes **Acceptance Criteria (AC)** written to be directly testable (unit/e2e).
- **Permission keys** referenced in stories come from the central permission catalog:

| Permission key | Grants |
|---|---|
| `*` | Wildcard — full access (reserved for the Super Admin system role) |
| `admins.read` | View admin accounts |
| `admins.create` | Create admin accounts |
| `admins.update` | Edit admin accounts, activate/deactivate |
| `admins.delete` | Delete admin accounts |
| `roles.read` | View roles and the permission catalog |
| `roles.create` | Create roles |
| `roles.update` | Edit role name/description/permissions |
| `roles.delete` | Delete roles |

> The catalog is defined once in code (`permissions.constants.ts`) and exposed via `GET /roles/permissions/catalog` so the frontend never hardcodes it. Future modules (tenants, billing, …) extend the same catalog (`tenants.read`, `billing.manage`, …).

---

## Epic 1 — Admin Authentication (SA-AUTH)

### SA-AUTH-1: Admin login
**As an** admin, **I want** to sign in with my email and password, **so that** I can access the dashboard securely.

**Acceptance criteria**
1. `POST /auth/login` accepts `{ email, password }`; both fields required and validated (email format, password non-empty).
2. On success it returns `{ accessToken, refreshToken, admin: { id, name, email, role: { id, name, permissions } } }`.
3. Access token is a JWT valid for **15 minutes**; refresh token is valid for **7 days**.
4. Passwords are stored only as bcrypt hashes (cost ≥ 10) — never in plain text, never returned by any endpoint.
5. Wrong email or wrong password both return **401** with the same generic message ("Invalid credentials") — no account enumeration.
6. A deactivated admin (`isActive = false`) receives **403** ("Account is deactivated") even with correct credentials.
7. `lastLoginAt` is updated on every successful login.

### SA-AUTH-2: Stay signed in (token refresh)
**As an** admin, **I want** my session to refresh silently, **so that** I am not logged out while actively working.

**Acceptance criteria**
1. `POST /auth/refresh` accepts `{ refreshToken }` and returns a new `{ accessToken, refreshToken }` pair (rotation).
2. Only the **hash** of the latest refresh token is stored on the admin record; presenting an old (rotated-out) or tampered token returns **401**.
3. Refreshing with a token of a deactivated admin returns **403**.

### SA-AUTH-3: Logout
**As an** admin, **I want** to log out, **so that** my refresh token can no longer be used.

**Acceptance criteria**
1. `POST /auth/logout` (authenticated) clears the stored refresh-token hash.
2. Any subsequent `POST /auth/refresh` with the old token returns **401**.
3. The frontend clears tokens and redirects to `/login`.

### SA-AUTH-4: Who am I
**As the** dashboard frontend, **I want** to fetch the current admin, **so that** I can render the UI according to their permissions.

**Acceptance criteria**
1. `GET /auth/me` (authenticated) returns `{ id, name, email, isActive, role: { id, name, permissions } }`.
2. Requests without a valid access token return **401**.

### SA-AUTH-5: Change my password
**As an** admin, **I want** to change my password, **so that** I can keep my account secure.

**Acceptance criteria**
1. `POST /auth/change-password` accepts `{ currentPassword, newPassword }`.
2. Fails with **400** if `currentPassword` is wrong; the response does not reveal any other account info.
3. `newPassword` must be ≥ 8 chars and contain at least one letter and one number (validated by DTO).
4. On success, the stored refresh-token hash is cleared (all other sessions are invalidated) and the user must log in again on other devices.

### SA-AUTH-6: Route protection (global)
**As the** platform owner, **I want** every endpoint locked by default, **so that** nothing is exposed accidentally.

**Acceptance criteria**
1. A global JWT guard protects **all** routes; only routes explicitly marked `@Public()` (login, refresh) skip it.
2. Expired/invalid tokens return **401** consistently.
3. The JWT payload carries `sub` (admin id) only; permissions are always loaded fresh from the DB by the permissions guard, so role changes apply without waiting for token expiry.

---

## Epic 2 — Manage Admins (SA-ADM)

### SA-ADM-1: List admins
**As an** admin with `admins.read`, **I want** to see all admin accounts with their role and status, **so that** I know who has access to the platform.

**Acceptance criteria**
1. `GET /admins` returns a paginated list: `{ data: [...], total, page, pageSize }` (default pageSize 20).
2. Each item includes `id, name, email, isActive, lastLoginAt, role { id, name }` — never a password hash.
3. Supports `?search=` (matches name or email, case-insensitive) and `?roleId=` filters.
4. Requesting without `admins.read` returns **403**.

### SA-ADM-2: Create an admin
**As an** admin with `admins.create`, **I want** to create a new admin with a role, **so that** teammates can help operate the platform with the right access.

**Acceptance criteria**
1. `POST /admins` accepts `{ name, email, password, roleId }`; all required and validated.
2. Email must be unique — duplicates return **409** ("Email already in use").
3. `roleId` must reference an existing role — otherwise **404**.
4. Password is bcrypt-hashed before saving; the response returns the created admin **without** any password field.
5. New admins are `isActive = true` by default.

### SA-ADM-3: Edit an admin
**As an** admin with `admins.update`, **I want** to edit an admin's name, email, role, or reset their password, **so that** access stays correct as the team changes.

**Acceptance criteria**
1. `PATCH /admins/:id` accepts any subset of `{ name, email, roleId, password }`.
2. Changing email keeps the uniqueness rule (**409** on conflict).
3. Setting a new password re-hashes it and clears the admin's refresh-token hash (forces re-login).
4. Unknown `:id` returns **404**.

### SA-ADM-4: Deactivate / reactivate an admin
**As an** admin with `admins.update`, **I want** to deactivate an admin instead of deleting them, **so that** access is revoked but history is preserved.

**Acceptance criteria**
1. `PATCH /admins/:id/status` accepts `{ isActive: boolean }`.
2. Deactivation clears the refresh-token hash; the account can no longer log in or refresh (SA-AUTH-1.6 / SA-AUTH-2.3).
3. An admin **cannot deactivate their own account** — returns **400** ("You cannot deactivate your own account").

### SA-ADM-5: Delete an admin
**As an** admin with `admins.delete`, **I want** to permanently remove an admin account, **so that** obsolete accounts don't accumulate.

**Acceptance criteria**
1. `DELETE /admins/:id` removes the account and returns **204**.
2. An admin **cannot delete their own account** — returns **400**.
3. Unknown `:id` returns **404**.

---

## Epic 3 — Roles & Permissions (SA-ROLE)

### SA-ROLE-1: View roles and the permission catalog
**As an** admin with `roles.read`, **I want** to see all roles, their permissions, and how many admins use each, **so that** I understand the current access model.

**Acceptance criteria**
1. `GET /roles` returns `[{ id, name, description, permissions, isSystem, adminsCount }]`.
2. `GET /roles/permissions/catalog` returns the full permission catalog grouped by module, e.g. `{ admins: ['admins.read', ...], roles: [...] }` — the source of truth for the frontend matrix UI.
3. Requests without `roles.read` return **403**.

### SA-ROLE-2: Create a role
**As an** admin with `roles.create`, **I want** to create a role with a set of permissions, **so that** I can grant tailored access.

**Acceptance criteria**
1. `POST /roles` accepts `{ name, description?, permissions: string[] }`.
2. Role name is unique (case-insensitive) — **409** on duplicate.
3. Every permission must exist in the catalog — unknown keys return **400** listing the invalid keys.
4. `permissions` may be empty (a role with no access is allowed but flagged in the UI).
5. Created roles have `isSystem = false`.

### SA-ROLE-3: Edit a role
**As an** admin with `roles.update`, **I want** to rename a role or change its permissions, **so that** access evolves with the team.

**Acceptance criteria**
1. `PATCH /roles/:id` accepts any subset of `{ name, description, permissions }` with the same validations as creation.
2. **System roles (`isSystem = true`, e.g. "Super Admin") cannot be modified** — returns **400**.
3. Permission changes take effect on the **next request** of every admin holding the role (guaranteed by SA-AUTH-6.3 — permissions are read from DB per request).

### SA-ROLE-4: Delete a role
**As an** admin with `roles.delete`, **I want** to delete an unused role, **so that** the role list stays clean.

**Acceptance criteria**
1. `DELETE /roles/:id` returns **204** on success.
2. System roles cannot be deleted — **400**.
3. A role assigned to one or more admins cannot be deleted — **409** ("Role is assigned to N admin(s)"); the UI offers to reassign first.

### SA-ROLE-5: Seeded Super Admin
**As the** platform owner, **I want** a seeded Super Admin role and account, **so that** the platform is usable immediately after deployment.

**Acceptance criteria**
1. A seed script creates the system role **Super Admin** with permissions `['*']` and one admin account from env vars (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).
2. Running the seed twice is idempotent (no duplicates).
3. The wildcard `*` passes every permission check in the permissions guard.

---

## Definition of Done (applies to every story)
- DTO validation with `class-validator`; invalid payloads return **400** with field-level messages.
- Endpoint protected by the global JWT guard + `@RequirePermissions(...)` where specified.
- **Unit tests** cover the service happy path + every failure branch listed in the ACs.
- No secrets in code; all configuration via environment variables.
- Frontend: loading, empty, and error states implemented; actions confirm destructive operations.
