# Epic 05 — Hotels (Tenants) Management (Super Admin Dashboard)

> **Scope:** Super Admin onboards and manages hotels (tenants) on the platform. This epic **extends the minimal Hotel stub** created in Epic 04 (id, name, status) via migrations — the stub table is never dropped or recreated. Onboarding wires directly into Plans & Subscriptions (Epic 04): every new hotel starts on a plan (Free Trial by default).
>
> **Permission catalog additions:**
> `hotels.read`, `hotels.create`, `hotels.update`, `hotels.suspend`
>
> Super Admin wildcard `*` covers all of the above.

---

## Story 5.1 — View Hotels List

**As a** platform admin with `hotels.read`,
**I want** to view a list of all hotels on the platform,
**so that** I can monitor the tenant base at a glance.

### Acceptance Criteria

- **AC1 — Access control:** Given an admin without `hotels.read`, when they request `GET /hotels`, then the API returns `403 Forbidden` and the "Hotels" sidebar item is hidden.
- **AC2 — List contents:** The table shows: hotel name, city, slug, current plan (with trial badge + days remaining where applicable), subscription status, hotel status (`active` / `suspended` / `inactive`), and onboarded date.
- **AC3 — Search & filters:** Search by name/slug; filter by hotel status, subscription status, plan, and city. Sortable by name, onboarded date, and plan.
- **AC4 — Pagination:** Server-side pagination (default 20 per page), consistent with the Admins list pattern.
- **AC5 — Empty state:** If no hotels exist, an empty state prompts admins with `hotels.create` to onboard the first hotel.

---

## Story 5.2 — View Hotel Details

**As a** platform admin with `hotels.read`,
**I want** to view a hotel's full profile,
**so that** I can support and manage that tenant.

### Acceptance Criteria

- **AC1 — Tabs:** The hotel details page has tabs: **Profile**, **Subscription**, **Owner**. (Future epics append tabs — e.g., Staff, Activity.)
- **AC2 — Profile tab:** Shows: name (EN/AR), slug, logo, star rating, contact email/phone, address, city, country, timezone, default language, currency, rooms count, status, and audit info (onboarded by, dates).
- **AC3 — Subscription tab:** Reuses the subscription view from Story 4.6 (current plan, status, usage vs. limits, history) and exposes the change-plan action for admins with `subscriptions.update` (Story 4.7).
- **AC4 — Owner tab:** Shows the hotel owner account (name, email, status, last login) — read-only in this epic; owner management actions come with Story 5.6.
- **AC5 — Access control:** Subscription tab content requires `subscriptions.read`; without it, the tab is hidden while Profile remains visible.

---

## Story 5.3 — Onboard New Hotel (Wizard)

**As a** platform admin with `hotels.create`,
**I want** a guided onboarding wizard,
**so that** a new hotel is fully provisioned (profile + plan + owner account) in one flow.

### Acceptance Criteria

- **AC1 — Access control:** The "Onboard Hotel" button and `POST /hotels` require `hotels.create`; otherwise `403`.
- **AC2 — Step 1 (Profile):** Required: name (EN + AR), slug, city, country (default Egypt), timezone (default Africa/Cairo), default language (default `ar`), currency (default `EGP`), contact email, contact phone. Optional: star rating, address, rooms count, logo.
- **AC3 — Slug rules:** Slug is lowercase kebab-case (`[a-z0-9-]`, 3–40 chars), globally unique, and validated live in the UI. Reserved words (`admin`, `api`, `app`, `www`, etc.) are rejected. The slug determines the tenant's URLs (tenant dashboard + guest app), so it is **immutable after creation** except by Super Admin (`*`), and any change is audit-logged with old/new values.
- **AC4 — Step 2 (Plan):** Plan selection shows only `active` plans. **Free Trial is pre-selected by default** (per Stories 4.8–4.9). Selecting the trial creates a `trial` subscription with `trial_ends_at = now + trial_duration_days`; selecting a paid plan requires choosing a billing cycle.
- **AC5 — Step 3 (Owner):** The admin enters the hotel owner's name and email. The system creates the owner account per Story 5.6.
- **AC6 — Atomicity:** Hotel + subscription + owner account are created in a single transaction — if any step fails, nothing is persisted, and the API returns the specific validation error.
- **AC7 — Result:** On success: `201` with the hotel object, redirect to the hotel details page showing a "Hotel onboarded" confirmation with the tenant URLs, and audit entry `hotel.created`.

---

## Story 5.4 — Edit Hotel Profile

**As a** platform admin with `hotels.update`,
**I want** to edit a hotel's profile,
**so that** tenant information stays accurate.

### Acceptance Criteria

- **AC1 — Access control:** Edit UI and `PATCH /hotels/:id` require `hotels.update`; otherwise `403`.
- **AC2 — Editable fields:** All profile fields from Story 5.3 AC2 **except slug** (immutable per 5.3 AC3; Super Admin override only).
- **AC3 — Rooms count vs. plan limit:** If the admin sets `rooms_count` above the hotel's current plan `max_rooms`, the API returns `409 Conflict` referencing the limit — consistent with the downgrade guard pattern (Story 4.7 AC3). Super Admin (`*`) may override with `force: true` (audit-logged).
- **AC4 — Audit:** Changes record `hotel.updated` with a before/after diff.

---

## Story 5.5 — Suspend / Reactivate Hotel

**As a** platform admin with `hotels.suspend`,
**I want** to suspend a hotel and later reactivate it,
**so that** the platform can act on non-payment or policy violations without deleting tenant data.

### Acceptance Criteria

- **AC1 — Access control:** `PATCH /hotels/:id/suspend` and `/reactivate` require `hotels.suspend`; otherwise `403`.
- **AC2 — Reason required:** Suspension requires a reason (enum: `non_payment`, `policy_violation`, `hotel_request`, `other` + free-text note). The reason is stored and shown in the hotel details.
- **AC3 — Suspension effect:** A suspended hotel's tenant dashboard and guest app are **fully locked** (staff cannot log in; guest app shows an "unavailable" page). This is stricter than trial expiry (read-only, Story 4.10 AC2). No tenant data is deleted.
- **AC4 — Subscription untouched:** Suspension does not change the subscription record — a suspended hotel can still have an `active` subscription (e.g., brief policy suspension).
- **AC5 — Reactivate:** Reactivation restores prior access immediately. Both actions are audit-logged (`hotel.suspended` with reason, `hotel.reactivated`).
- **AC6 — No hard delete:** There is no `DELETE /hotels/:id`. Permanent offboarding is a future epic (data export + retention policy required first).

---

## Story 5.6 — Hotel Owner Account Provisioning

**As a** platform admin with `hotels.create`,
**I want** the system to create the hotel owner's account during onboarding,
**so that** the hotel can immediately access its tenant dashboard.

### Acceptance Criteria

- **AC1 — Owner account:** Onboarding Step 3 creates a tenant-scoped user with role **Hotel Owner** — the hotel's own "super admin", holding the tenant wildcard `*` (full permissions **within their hotel only**, mirroring the platform's central permission catalog pattern). The owner will add and manage further hotel admins/staff from the Tenant Dashboard (its own Auth/Staff/Roles epics); the Super Admin dashboard never manages tenant staff beyond the owner.
- **AC2 — Email uniqueness:** Owner email must be unique across tenant users. Conflict returns `422` inside the wizard without losing entered data.
- **AC3 — Credential delivery (pre-Notifications):** Since the Notifications epic isn't built yet, the system generates a **one-time setup link** (signed token, 72h expiry) displayed **once** to the onboarding admin with a copy button, to share with the hotel manually. The link lets the owner set their password. The token is hashed at rest and single-use.
- **AC4 — Link regeneration:** An admin with `hotels.update` can regenerate the setup link from the Owner tab (invalidates the previous one; audit-logged `hotel.owner_link_regenerated`).
- **AC5 — Future hook:** When the Notifications epic ships, AC3's manual sharing is replaced by an automated email — the token mechanism stays the same.

---

## Story 5.7 — Tenant URLs & Provisioning

**As a** platform admin with `hotels.read`,
**I want** each hotel's tenant URLs visible and consistent,
**so that** access details can be shared with the hotel unambiguously.

### Acceptance Criteria

- **AC1 — URL scheme:** Each hotel gets two URLs derived from its slug: tenant dashboard (`{slug}.gxp.example` or `/t/{slug}` — final scheme per code-structure decision) and guest app (`guest.gxp.example/{slug}`).
- **AC2 — Display:** Both URLs appear on the hotel details Profile tab with copy buttons, and in the onboarding success screen (5.3 AC7).
- **AC3 — Status behavior:** URLs of a `suspended` hotel resolve to the locked/unavailable page (5.5 AC3), and of an `expired`-trial hotel to the read-only mode (4.10 AC2) — never to a broken page.

---

## Implementation Notes for Claude Code

Guidance and constraints to respect when planning/implementing this epic — structure and file layout are up to you, but follow the existing project conventions (NestJS clean architecture: thin controllers, service-layer logic, global JWT + Permissions guards; Next.js admin frontend with brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **Extend, never recreate:** The `hotels` table exists as a stub from Epic 04 (id, name, status). Extend it via migration only.
2. **Onboarding is one transaction:** hotel insert → subscription creation (reuse Epic 04's subscriptions service; Free Trial default) → owner + setup token. Any failure rolls back everything. Keep wizard/onboarding logic in its own service, separate from hotel CRUD.
3. **Storage abstraction from day one:** a single storage interface with two drivers — `local` (default) and `s3` — selected via `STORAGE_DRIVER` env var. Store storage *keys* in the DB (e.g., `logo_path`), never full URLs. This is the pattern for all future uploads platform-wide. Suggested env: `STORAGE_DRIVER`, `UPLOADS_PATH`, `S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY`.
4. **Slug is critical:** lowercase kebab-case `[a-z0-9-]` 3–40 chars, globally unique, reserved-words list (`admin`, `api`, `app`, `www`, `guest`, ...), **immutable** after creation except Super Admin `*` (audit-logged). Tenant URLs are computed from env (`TENANT_BASE_DOMAIN` → `{slug}.domain`, `GUEST_APP_BASE_URL` → `/{slug}`), never stored.
5. **Setup tokens security:** raw token returned exactly once in the onboarding response; only a hash is stored; 72h expiry (env-configurable); single-use; regeneration invalidates prior tokens. The consuming endpoint (`POST /tenant-users/setup` — set password) is public and must be rate-limited.
6. **`tenant_users` is a stub:** owner only, `role='owner'`, permissions `['*']` (tenant-scoped), status `pending` until password set. Tenant RBAC/staff management comes with the Tenant Dashboard epics — don't build it here.
7. **Guards follow Epic 04 patterns:** `rooms_count` vs. plan `max_rooms` → `409` with details, `force: true` allowed for `*` only and audit-logged. No hard-delete endpoints anywhere.
8. **Suspension ≠ trial expiry:** suspension fully locks the tenant (no staff login, guest app unavailable); expired trial is read-only. Two distinct states — don't merge them.
9. **Audit everything:** `hotel.created` / `hotel.updated` (diff) / `hotel.suspended` (reason) / `hotel.reactivated` / `hotel.slug_changed` / `hotel.owner_link_regenerated`, via the existing audit mechanism.
10. **Bilingual UI:** all new admin UI strings in EN + AR, RTL-safe, consistent with existing pages. Logo upload: png/jpg/webp/svg, ≤ 2MB, client + server validation.
11. **Tests:** unit tests at the service layer minimum — onboarding rollback, slug rules, token lifecycle (hash/expiry/single-use), rooms-count guard, suspend/reactivate. Keep the TypeScript build clean.

---

## Notes & Dependencies

- **Extends:** Epic 04's Hotel stub via migration (adds profile columns). The `hotels` table is never recreated.
- **Depends on:** Epics 01–04. Onboarding consumes Plans (active plans list, trial defaulting) and Subscriptions (creation, usage-vs-limit guards).
- **Blocks:** Tenant Dashboard epics (owner account + tenant RBAC seed originate here), Guest App (guest URL per hotel).
- **Deferred:** Automated credential emails (Notifications epic), permanent offboarding/data export, hotel staff management beyond the owner (Tenant Dashboard scope), multi-property groups/chains (single property per tenant for now).

### Resolved decisions

1. **Tenancy URL scheme:** **Subdomain per tenant** (`{slug}.domain`) is the primary scheme, with path-based prefix (`/t/{slug}`) also resolving as a fallback. Final routing details will be revisited when building the Tenant (Hotel) Dashboard, which is a separate app.
2. **Logo/file storage:** Storage driver is **configurable via env** (`STORAGE_DRIVER=local|s3`), **default `local`** for now, S3-compatible for production later. Same interface either way — this sets the pattern for all future uploads.
3. **Rooms count:** Manual field on the hotel profile for now (feeds plan-limit guards); replaced by real room records once the Tenant Dashboard rooms module exists.
4. **Hotel admins:** Epic 05 provisions **only the Hotel Owner** (tenant-scoped super admin with tenant wildcard `*` — full control within their hotel only). Adding further hotel admins/staff is done by the owner **from the Tenant Dashboard**, and belongs to the Tenant Dashboard's own Auth/Staff/Roles epics (mirroring platform Epics 01–03).
