# Epic 10 — Tenant Dashboard: Roles & Permissions

> **Scope:** Full role management inside the Tenant Dashboard: view roles, create custom roles with a permission matrix, edit, delete — mirroring the platform's Roles & Permissions epic (Epic 03) but **tenant-scoped**. Builds on the roles data layer + seeded defaults from Epic 09.
>
> **Tenant permission catalog additions:**
> `roles.read`, `roles.create`, `roles.update`, `roles.delete`
>
> Owner wildcard `*` covers all. The **tenant permission catalog** is the single source of truth for all tenant permissions; every future tenant module epic (rooms, requests, housekeeping, ...) registers its permissions there.

---

## Story 10.1 — View Roles

**As a** hotel user with `roles.read`,
**I want** to see my hotel's roles and what each can do,
**so that** access design is transparent.

### Acceptance Criteria

- **AC1 — Access control:** Roles endpoints/nav require `roles.read`; otherwise `403` / hidden. (The staff-dropdown list endpoint from Epic 09 migrates to this permission — see note 2.)
- **AC2 — List:** role name (localized), description, staff count, system badge (Owner), created date.
- **AC3 — Detail:** the role's permissions rendered as a grouped, read-only matrix (groups = catalog namespaces: staff, roles, and future modules), with the Owner role showing `*` = full access clearly.

---

## Story 10.2 — Create Custom Role

**As a** hotel user with `roles.create`,
**I want** to create a role with a custom permission set,
**so that** access matches how my hotel actually operates.

### Acceptance Criteria

- **AC1 — Form:** name (EN + AR), optional description (EN + AR), permission matrix with grouped checkboxes + per-group select-all — same UX as the platform matrix editor (Epic 03), reusing its interaction pattern.
- **AC2 — Validation:** name unique within the hotel (per language, case-insensitive); at least one permission required; only permissions from the tenant catalog accepted (`422` otherwise); `*` is **not** assignable to custom roles (Owner-only).
- **AC3 — Escalation guard:** A user can only grant permissions **they themselves hold** — creating/editing a role with permissions beyond one's own returns `403` per-permission detail. (Owner `*` holders are unaffected.)
- **AC4 — Audit:** `role.created` with the permission set.

---

## Story 10.3 — Edit Role

**As a** hotel user with `roles.update`,
**I want** to edit a role's details and permissions,
**so that** roles evolve with the operation.

### Acceptance Criteria

- **AC1 — Editable:** name, description, permissions — same validation + escalation guard as Story 10.2. System roles (Owner) are not editable (`403`, hidden edit action).
- **AC2 — Impact awareness:** If the role has assigned staff, the UI shows the affected count before saving (pattern from Epic 04, Story 4.4 AC2).
- **AC3 — Effect:** Changes apply to assigned staff on their next request (per-request permission evaluation from Epic 08). No re-login required.
- **AC4 — Audit:** `role.updated` with before/after diff.

---

## Story 10.4 — Delete Role

**As a** hotel user with `roles.delete`,
**I want** to delete roles that are no longer needed,
**so that** the roles list stays clean.

### Acceptance Criteria

- **AC1 — Guard:** Roles with assigned staff cannot be deleted — `409` with the count; staff must be reassigned first (Epic 09 edit flow). System roles cannot be deleted.
- **AC2 — Default roles deletable:** Non-system seeded defaults (Manager, Front Desk, Housekeeping) **are** deletable once unassigned — they're a starting point, not a constraint.
- **AC3 — Hard delete acceptable here:** Unlike business records, an unassigned role holds no history worth preserving; hard delete with `role.deleted` audit (name + permission set captured in the audit entry) is fine.

---

## Story 10.5 — Tenant Permission Catalog Governance

**As the** platform owner,
**I want** the tenant permission catalog to be centrally defined and forward-extensible,
**so that** every future tenant module plugs into RBAC consistently.

### Acceptance Criteria

- **AC1 — Single source:** One code-versioned tenant catalog (mirroring the platform catalog's structure): key, group, localized label + description (AR/EN). The matrix UI renders **from the catalog** — adding a module's permissions requires no matrix-UI changes.
- **AC2 — Unknown-key safety:** Permission checks against keys not in the catalog fail closed (deny + logged warning) — a typo can never grant access.
- **AC3 — Module gating interplay:** Permissions belonging to a module not enabled in the hotel's plan (Epic 04 `enabled_modules`, enforced per Epic 08, Story 8.6 AC3) are hidden from the matrix UI and inert if present on a role (module gate is checked **before** permissions). Roles keep such permissions dormant — re-enabling the module restores them without reconfiguration.

---

## Implementation Notes for Claude Code

Follow existing conventions (NestJS clean architecture; tenant guards + isolation from Epic 08; tenant app i18n AR/EN; brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **Mirror Epic 03 deliberately:** the platform Roles module is the blueprint — same service patterns, same matrix editor UX. Adapt for: tenant scoping (`hotel_id` everywhere), the escalation guard (10.2 AC3 — the platform side may not have needed it; tenant side does because non-`*` users can hold `roles.create`), and localized role names.
2. **Permission migration from Epic 09:** the staff invite/edit role dropdown moves from `staff.read` gating to `roles.read`… **no** — keep the lightweight dropdown endpoint on `staff.read` (inviting requires seeing roles) and gate the full roles module (matrix, CRUD) on `roles.*`. Two endpoints, clearly named, no permission surprises for Front Desk-type roles.
3. **Catalog structure:** extend the tenant catalog constant started in Epics 08–09 with `roles.*`; include group metadata + AR/EN labels per AC 10.5 AC1. Keep platform and tenant catalogs as **separate constants** — never merged, never cross-imported into guards.
4. **Escalation guard implementation:** compute the acting user's effective permission set once per request (already needed by the guard) and diff against the submitted role permissions; return the offending keys in the error payload for a precise UI message.
5. **Module-gating interplay (10.5 AC3):** the check order in the tenant permissions guard must be: hotel active → subscription state → module enabled → permission. Matrix UI filters catalog groups by the hotel's enabled modules (from the same `TenantAccessService`, Epic 08 note 4).
6. **Frontend:** Roles section: list, detail (read-only matrix), create/edit pages with the matrix editor, delete confirm with 409 handling. Reuse/port the platform matrix component's logic; strings AR/EN.
7. **Tests:** escalation guard (partial-permission user), unknown-key fail-closed, delete guards (assigned staff, system role), module-dormant permissions (disabled module ⇒ permission inert even if on role), name uniqueness per language, cross-tenant isolation (404). TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epic 09 (roles table + seeded defaults + staff assignment), Epic 08 (guards, per-request evaluation, `TenantAccessService`).
- **Blocks / feeds:** every tenant operational module epic (rooms, guest requests, housekeeping, F&B, transportation coordination) — each will add its permissions to the tenant catalog and rely on this matrix.
- **Deferred:** role templates suggested by hotel type, permission usage analytics, cross-hotel role copying (multi-property future).
