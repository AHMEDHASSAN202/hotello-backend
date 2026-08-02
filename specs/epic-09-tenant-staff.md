# Epic 09 — Tenant Dashboard: Staff Management

> **Scope:** The hotel owner (and staff with the right permissions) manage the hotel's staff accounts from the Tenant Dashboard: invite, list, edit, disable/enable, resend invites. Invitations reuse the setup-token + email pipeline (Epics 05–06). Staff counts are guarded against the plan's `max_staff_users` limit (Epic 04).
>
> **Roles note:** This epic introduces the tenant `roles` data layer with **seeded default roles** so staff can be assigned a role at invite time. The full role management UI/API (create/edit custom roles, permission matrix) is Epic 10.
>
> **Tenant permission catalog additions:**
> `staff.read`, `staff.invite`, `staff.update`, `staff.disable`
>
> Owner wildcard `*` covers all.

---

## Story 9.1 — Seeded Default Roles (Data Layer)

**As the** platform owner,
**I want** every hotel to start with sensible default roles,
**so that** staff can be invited immediately without configuring RBAC first.

### Acceptance Criteria

- **AC1 — Defaults:** Each hotel gets seeded tenant roles: **Owner** (`*`, system role), **Manager** (broad operational permissions), **Front Desk**, **Housekeeping** (narrow, module-relevant permissions — exact sets defined against the tenant catalog as it grows; start with staff/roles permissions only and extend per module epic).
- **AC2 — Existing hotels:** Seeding applies to newly onboarded hotels **and** backfills existing hotels (idempotent seed).
- **AC3 — Owner role protection:** The Owner role is flagged `is_system`; it cannot be edited, deleted, or stripped of `*` (enforced in Epic 10's UI and at the service layer here).
- **AC4 — Names bilingual:** Default role names/descriptions exist in AR + EN.

---

## Story 9.2 — Staff List

**As a** hotel user with `staff.read`,
**I want** to see all my hotel's staff,
**so that** I know who has access and in what role.

### Acceptance Criteria

- **AC1 — Access control:** `GET` staff endpoints and the "Staff" nav item require `staff.read`; otherwise `403` / hidden.
- **AC2 — List:** name, email, role, status (`pending` — invited not yet activated / `active` / `disabled`), last login. Search by name/email; filter by role and status; server-side pagination.
- **AC3 — Tenant isolation:** Only the authenticated user's hotel staff — ever (per Epic 08 isolation rules).

---

## Story 9.3 — Invite Staff

**As a** hotel user with `staff.invite`,
**I want** to invite a staff member by email with a role,
**so that** they can activate their own account securely.

### Acceptance Criteria

- **AC1 — Form:** name, email, role (from the hotel's roles; Owner role is **not** selectable — one owner per hotel in this phase). Email must be unique across tenant users (`422` on conflict).
- **AC2 — Plan limit guard:** If active + pending staff count has reached the plan's `max_staff_users`, the invite is rejected with `409` and a clear translated message including the limit — consistent with Epic 04's guard patterns. (`null` limit = unlimited.)
- **AC3 — Delivery:** Creates the user as `pending` + setup token (same mechanism as the owner's, Epic 05) and queues a `staff_invite` email (new typed-TS template, AR/EN by hotel `default_language`) through the Epic 06 pipeline.
- **AC4 — Activation:** The invitee activates via the same setup flow (Epic 08, Story 8.2) — password set → `active` → logged in.
- **AC5 — Audit:** `staff.invited` recorded with inviter, invitee email, and role.

---

## Story 9.4 — Edit Staff

**As a** hotel user with `staff.update`,
**I want** to edit a staff member's name and role,
**so that** access matches responsibilities as they change.

### Acceptance Criteria

- **AC1 — Editable:** name, role. Email is immutable (identity anchor — disable + re-invite for a new address).
- **AC2 — Owner protections:** The owner account cannot be edited by anyone (including themselves via this screen — own name changes via My Profile, Story 8.7). No one can be promoted **to** Owner here.
- **AC3 — Self-guard:** Users cannot change their **own** role.
- **AC4 — Effect & audit:** Role changes take effect on the user's next request (permissions evaluated per request per Epic 08). `staff.updated` audit with diff.

---

## Story 9.5 — Disable / Enable Staff

**As a** hotel user with `staff.disable`,
**I want** to disable a staff member's access (and re-enable it later),
**so that** departures and returns are handled without deleting anything.

### Acceptance Criteria

- **AC1 — Disable:** `disabled` users cannot log in (Epic 08, Story 8.3 AC2) and their existing sessions are invalidated immediately. Their records/history remain intact — **no hard delete endpoint exists**.
- **AC2 — Guards:** The owner cannot be disabled. Users cannot disable themselves.
- **AC3 — Pending invites:** Disabling a `pending` user also invalidates their outstanding setup token.
- **AC4 — Enable:** Re-enabling restores login for `active`-history users; for `pending` users it requires resending the invite (Story 9.6).
- **AC5 — Audit:** `staff.disabled` / `staff.enabled` recorded.

---

## Story 9.6 — Resend Invite

**As a** hotel user with `staff.invite`,
**I want** to resend a pending staff member's invitation,
**so that** lost or expired invites don't require support tickets.

### Acceptance Criteria

- **AC1 — Behavior:** Available only for `pending` users. Generates a **new** token (prior invalidated — regeneration semantics from Epic 05, Story 5.6 AC4) and queues a fresh `staff_invite` email.
- **AC2 — Rate limit:** Max 1 resend per user per 10 minutes (prevents accidental spam).
- **AC3 — Audit:** `staff.invite_resent` recorded.

---

## Story 9.7 — Add Staff Directly (Username + Password)

**As a** hotel user with `staff.invite`,
**I want** to create a staff account directly with a username and password I hand over myself,
**so that** on-ground staff — most of whom have no usable email — get a working account immediately with zero email dependency.

### Acceptance Criteria

- **AC1 — Two paths, one screen:** The "Add Staff" flow offers both methods: **Invite by email** (Story 9.3, default for desk/management staff) and **Create directly**. Both are gated by the same `staff.invite` permission — it is the "bring people in" permission regardless of credential delivery.
- **AC2 — Direct form:** name, **username** (required; lowercase, 3–30 chars, `[a-z0-9._-]`; unique **within the hotel** — the same username can exist at other hotels since login is tenant-scoped), email (**optional**), role, and a temporary password: generated by default (with copy button) or manually entered — either way validated against the standard password policy.
- **AC3 — Identifier rule:** Every account has at least one identifier — email, username, or both. Invited accounts (Story 9.3) keep email required and get no username by default. Usernames cannot look like emails (`@` rejected) to keep login-identifier detection unambiguous.
- **AC4 — Immediate activation + forced change:** The account is created as `active` with `must_change_password = true`. On first login, the user is forced into a change-password screen before reaching anything else (all other routes blocked until done). After changing it, the flag clears.
- **AC5 — Password display:** The temporary password is shown **exactly once** on the success screen (same one-time pattern as setup links, Epic 05) alongside the username and the login URL — never stored raw, never emailed, never retrievable. If lost, use Story 9.8.
- **AC6 — Seat limit:** Direct creation counts toward `max_staff_users` identically to invites (`active` + `pending`; owner excluded per the confirmed decision). Same `409` behavior at the limit.
- **AC7 — Optional welcome email:** Only when an email was provided, an optional "send welcome email" checkbox queues a `staff_welcome` email (typed-TS template, AR/EN) containing the login URL and username — **never the password**.
- **AC8 — Audit:** `staff.created_direct` recorded (username, role, whether a welcome email was sent — password never in audit).

---

## Story 9.8 — Reset Staff Password (Manager Action)

**As a** hotel user with `staff.update`,
**I want** to reset a staff member's password myself,
**so that** username-only accounts (which cannot use email self-reset) are never locked out permanently.

### Acceptance Criteria

- **AC1 — Action:** A "Reset password" action on a staff member generates a new temporary password, shown **exactly once** (same pattern as 9.7 AC5), and sets `must_change_password = true`.
- **AC2 — Session kill:** All of that user's existing sessions are invalidated immediately, and any outstanding setup/reset tokens for them are invalidated too.
- **AC3 — Scope:** Available for any staff member regardless of account type (email accounts can still self-reset via Story 8.4 — this is the manager-side fallback). **Not** available against the owner (the owner self-resets via email only), and not against yourself (use My Profile, Story 8.7).
- **AC4 — Abuse guard:** Rate-limited per target user (e.g., max 3 per hour) and always audit-logged: `staff.password_reset_by_manager` (actor + target — password never in audit).

### Implementation additions for Claude Code

- `tenant_users` changes: add `username` (nullable; unique per `hotel_id` via partial index; lowercase-normalized) and make `email` nullable, with a CHECK constraint that at least one of the two is present. Invite flow unchanged (email required there).
- Login identifier handling is specified in Epic 08 (Story 8.3) — input containing `@` is looked up as email, otherwise as username, both within the resolved tenant.
- Add `must_change_password` (boolean, default false); enforce via a guard on tenant routes (excluding auth/change-password), mirroring the read-only guard exclusion pattern (Epic 08 note 5). Completing any reset flow (8.4 or 9.8) clears the flag.
- Reuse the existing password policy validation; add one small shared password/username generator utility if none exists.
- Welcome-email template renders only for accounts with email; template variables must not assume email presence elsewhere.
- **Deferred (do not build now):** phone-number login for workers — revisit in the Staff Task PWA epic if needed; username covers the need until then.

---

## Implementation Notes for Claude Code

Follow existing conventions (NestJS clean architecture; tenant guards + isolation from Epic 08; typed-TS email templates from Epic 06; tenant app i18n AR/EN; brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **Extend `tenant_users`, don't fork it:** the Epic 05 stub grows (role becomes a FK to the new tenant `roles` table — migrate the owner's `role='owner'` string + `['*']` permissions into the seeded Owner role). Permissions resolve **through the role** now; drop or deprecate the per-user permissions array to keep one source of truth (mirror how the platform side resolves admin permissions).
2. **Tenant roles table (data layer only here):** `id, hotel_id, name_en, name_ar, description_en/ar, permissions (text[]), is_system`. Unique (hotel_id, name per language). CRUD API/UI is Epic 10 — here only: seeded defaults + list endpoint for the invite/edit dropdowns (`GET` gated by `staff.read` is acceptable until Epic 10 introduces `roles.read`).
3. **Idempotent seed:** default roles seeding must be re-runnable and hooked into onboarding (new hotels) — extend Epic 05's onboarding transaction.
4. **Plan limit check counts `active` + `pending`** (a pending invite reserves a seat) — evaluated in the service inside the invite transaction to avoid race over the last seat.
5. **Reuse the token + email machinery wholesale:** same token entity/service as owner setup, new notification type + template only. Invite email language: hotel `default_language` (invitee has no preference yet).
6. **Session invalidation on disable** must actually work with the chosen token strategy — if JWTs are stateless, implement the same invalidation approach used for password reset (Story 8.4 AC3); keep one mechanism.
7. **Frontend:** Staff section in the tenant app: list page, invite modal (or page — match the app's emerging pattern), edit modal, disable/enable confirm dialogs, resend action with cooldown state. All strings AR/EN.
8. **Tests:** limit guard incl. race (two invites, one seat), owner protections, self-guards, disable → session invalid + token invalidated, resend regeneration, isolation (cross-tenant staff access 404). TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epic 08 (tenant auth, guards, setup flow). Epics 04–06 machinery (limits, tokens, notifications).
- **Blocks:** Epic 10 builds on the roles data layer introduced here; operational module epics assume staff exist.
- **Deferred:** ownership transfer / multiple owners, per-staff notification preferences, bulk invites.
