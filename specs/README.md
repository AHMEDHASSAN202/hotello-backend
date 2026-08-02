# Specs

Feature specs — single source of truth. Read the relevant epic fully before planning or implementing.

| # | Epic | Status |
|---|---|---|
| 01 | [Super Admin auth & RBAC](epic-01-03-super-admin-foundation.md) | implemented |
| 02 | [Admin management](epic-01-03-super-admin-foundation.md) | implemented |
| 03 | [Roles & permissions](epic-01-03-super-admin-foundation.md) | implemented |
| 04 | [Plans & Subscriptions](epic-04-plans-subscriptions.md) | implemented |
| 05 | [Hotels (Tenants) Management](epic-05-hotels-management.md) | implemented |
| 06 | [Notifications](epic-06-notifications.md) | implemented |
| 07 | [Admin Dashboard Localization](epic-07-admin-localization.md) | implemented |
| 08 | [Tenant Auth & App Foundation](epic-08-tenant-auth.md) | implemented |
| 09 | [Tenant Staff Management](epic-09-tenant-staff.md) | implemented |
| 10 | [Tenant Roles & Permissions](epic-10-tenant-roles.md) | implemented |
| 11 | Rooms & QR | planned — next up (no spec file yet) |
| 12 | [In-App Guidance & Helper Text](epic-12-guidance-helper-text.md) | implemented |
| — | [Task: Migration Infrastructure Setup](task-migrations-setup.md) | done |

## Notes

- **Epics 01–03** share one legacy combined spec,
  [epic-01-03-super-admin-foundation.md](epic-01-03-super-admin-foundation.md),
  which predates the per-epic format (story IDs `SA-AUTH-*`, `SA-ADM-*`,
  `SA-ROLE-*` — the backend test names still reference them). That copy is
  canonical; the workspace original is a historical artifact.
- **Epic 11 (Rooms & QR)** has no spec file yet — write it before implementation.
  Epic 12's definition-of-done rule applies to it: no form, filter, list, status,
  or confirmation ships without its guidance strings.
- **Migrations task — done.** Verified in this repo: `src/data-source.ts` exists,
  `synchronize: false` is set in `src/config/database.config.ts`, the six
  `migration:*` npm scripts are present (including the `migration:check` drift
  guard), and `src/migrations/` holds the baseline plus five feature migrations.
  Every entity change now ships its migration in the same PR.
