# Epic 04 — Plans & Subscriptions Management (Super Admin Dashboard)

> **Scope:** Super Admin manages subscription plans that hotels (tenants) subscribe to. Plans define pricing, limits, and which platform modules are enabled per tenant. Even if the platform launches with a single default plan, this module is the foundation for feature gating and future pricing tiers.
>
> **Permission catalog additions:**
> `plans.read`, `plans.create`, `plans.update`, `plans.archive`, `subscriptions.read`, `subscriptions.update`
>
> Super Admin wildcard `*` covers all of the above.

---

## Story 4.1 — View Plans List

**As a** platform admin with `plans.read`,
**I want** to view a list of all subscription plans,
**so that** I can understand what offerings exist and their current status.

### Acceptance Criteria

- **AC1 — Access control:** Given an admin without `plans.read`, when they request `GET /plans`, then the API returns `403 Forbidden` and the sidebar item "Plans" is hidden in the UI.
- **AC2 — List contents:** Given an admin with `plans.read`, when they open the Plans page, then they see a table with: plan name, monthly price, yearly price, billing currency, number of subscribed hotels, status (`active` / `archived`), and created date.
- **AC3 — Sorting & filtering:** The list supports filtering by status and sorting by name, price, and subscriber count.
- **AC4 — Empty state:** If no plans exist, an empty state prompts admins with `plans.create` to create the first plan (e.g., a "Standard" default plan).

---

## Story 4.2 — View Plan Details

**As a** platform admin with `plans.read`,
**I want** to view the full details of a plan,
**so that** I can see exactly what limits and modules it grants.

### Acceptance Criteria

- **AC1 — Detail view:** Given an admin with `plans.read`, when they open a plan, then they see: name (EN/AR), description (EN/AR), pricing (monthly/yearly, currency), limits, enabled modules, status, and audit info (created by, created at, last updated).
- **AC2 — Limits displayed:** Limits include at minimum: `max_rooms`, `max_staff_users`, `max_guest_requests_per_month` (nullable = unlimited).
- **AC3 — Modules displayed:** Enabled modules are shown as a checklist against the platform module catalog (e.g., `transportation`, `housekeeping`, `fnb`, `guest_app_branding`, `analytics`).
- **AC4 — Subscribers tab:** A "Subscribed Hotels" tab lists all tenants currently on this plan (name, subscription start date, billing cycle), visible only to admins who also hold `subscriptions.read`.

---

## Story 4.3 — Create Plan

**As a** platform admin with `plans.create`,
**I want** to create a new subscription plan,
**so that** the platform can offer new pricing tiers without code changes.

### Acceptance Criteria

- **AC1 — Access control:** The "Create Plan" button and `POST /plans` require `plans.create`; otherwise `403`.
- **AC2 — Required fields:** name (EN + AR), monthly price, currency (default `EGP`), and at least one enabled module. Yearly price is optional; if omitted, yearly billing is unavailable for this plan.
- **AC3 — Validation:** Plan name must be unique (case-insensitive, per language). Prices must be `>= 0` (0 allows free/trial plans). Limits must be positive integers or `null` for unlimited.
- **AC4 — Module selection:** Modules are selected from the central platform module catalog only — free-text module names are rejected with `422`.
- **AC5 — Result:** On success the API returns `201` with the plan object, the plan appears in the list as `active`, and an audit log entry `plan.created` is recorded with the acting admin's ID.

---

## Story 4.4 — Edit Plan

**As a** platform admin with `plans.update`,
**I want** to edit an existing plan's pricing, limits, and modules,
**so that** offerings can evolve with the market.

### Acceptance Criteria

- **AC1 — Access control:** Edit UI and `PATCH /plans/:id` require `plans.update`; otherwise `403`.
- **AC2 — Impact warning:** Given the plan has ≥1 subscribed hotel, when the admin changes limits or enabled modules, then the UI shows a confirmation dialog stating how many tenants will be affected before saving.
- **AC3 — Downgrade guard:** If a new limit is lower than a current subscriber's actual usage (e.g., `max_rooms = 50` while a hotel has 80 rooms), the API returns `409 Conflict` listing the violating tenants. The admin must resolve those subscriptions first.
- **AC4 — Immediate effect:** Module enable/disable changes propagate to affected tenants' feature flags on save (tenant dashboards re-evaluate on next request/session refresh).
- **AC5 — Audit:** Every change records `plan.updated` with a before/after diff.

---

## Story 4.5 — Archive Plan

**As a** platform admin with `plans.archive`,
**I want** to archive a plan instead of deleting it,
**so that** historical billing data stays intact while the plan stops being offered.

### Acceptance Criteria

- **AC1 — Access control:** Archive action and `PATCH /plans/:id/archive` require `plans.archive`; otherwise `403`.
- **AC2 — No hard delete:** There is no `DELETE /plans/:id` endpoint. Plans are soft-archived only.
- **AC3 — Guard on active subscribers:** Given a plan with ≥1 active subscription, when the admin attempts to archive it, then the API returns `409 Conflict` with the subscriber count. The admin must migrate those hotels to another plan first (Story 4.7).
- **AC4 — Behavior after archive:** Archived plans are hidden from plan-selection dropdowns (e.g., hotel onboarding) but remain visible in the plans list under the "Archived" filter and in historical records.
- **AC5 — Restore:** An admin with `plans.update` can restore an archived plan back to `active`. Audit entries `plan.archived` / `plan.restored` are recorded.

---

## Story 4.6 — View a Hotel's Subscription

**As a** platform admin with `subscriptions.read`,
**I want** to view a hotel's current subscription,
**so that** I can support billing and account questions.

### Acceptance Criteria

- **AC1 — Access control:** `GET /hotels/:id/subscription` requires `subscriptions.read`; otherwise `403`.
- **AC2 — Contents:** The subscription view shows: current plan, billing cycle (monthly/yearly), start date, next renewal date, status (`active`, `trial`, `past_due`, `canceled`), and subscription history (previous plans with date ranges).
- **AC3 — Usage vs. limits:** The view shows current usage against plan limits (rooms used / max, staff users / max) with a visual indicator when usage exceeds 80% of any limit.

---

## Story 4.7 — Change a Hotel's Plan

**As a** platform admin with `subscriptions.update`,
**I want** to move a hotel to a different plan,
**so that** upgrades, downgrades, and plan migrations are handled centrally.

### Acceptance Criteria

- **AC1 — Access control:** `PATCH /hotels/:id/subscription` requires `subscriptions.update`; otherwise `403`.
- **AC2 — Plan choices:** Only `active` plans are selectable as the target. Archived plans are excluded.
- **AC3 — Downgrade guard:** If the hotel's current usage exceeds any limit of the target plan, the API returns `409 Conflict` detailing each violation (e.g., "Hotel has 12 staff users; target plan allows 5"). The change is blocked until resolved or overridden by Super Admin (`*`) with an explicit `force: true` flag, which is itself audit-logged.
- **AC4 — Module transition:** On plan change, tenant feature flags are recalculated. Modules no longer included become read-only/hidden in the tenant dashboard; no tenant data is deleted.
- **AC5 — History:** The previous subscription record is closed with an end date and a new record is created — no in-place overwrite. Audit entry `subscription.changed` records old plan, new plan, and acting admin.

---

## Story 4.8 — Default Plan for Launch

**As the** platform owner,
**I want** a seeded default "Standard" plan,
**so that** the platform can launch with a single plan while keeping the full plans infrastructure in place.

### Acceptance Criteria

- **AC1 — Seed:** A database seed creates one `active` plan named "Standard" (EN) / "الأساسية" (AR) with all current modules enabled and unlimited limits (`null`).
- **AC2 — Onboarding default:** The hotel-creation flow (upcoming Hotels epic) pre-selects the default plan when only one active plan exists, keeping onboarding friction-free.
- **AC3 — No hardcoding:** No code path assumes a single plan — everything reads from the plans table, so adding tiers later requires zero code changes.

---

## Story 4.9 — Free Trial Plan (14 Days, Full Access)

**As the** platform owner,
**I want** a seeded "Free Trial" plan that grants all modules for 14 days,
**so that** hotels can experience the full platform before committing to a paid plan.

### Acceptance Criteria

- **AC1 — Seed:** A database seed creates an `active` plan named "Free Trial" (EN) / "التجربة المجانية" (AR) with: price = 0, **all platform modules enabled**, unlimited limits (`null`), and `trial_duration_days = 14`.
- **AC2 — Plan type flag:** The plans schema includes `is_trial: boolean` (default `false`). Exactly one active trial plan may exist at a time — creating a second active trial plan returns `409 Conflict`.
- **AC3 — Subscription behavior:** When a hotel is subscribed to the trial plan, the subscription is created with status `trial`, `start_date = now`, and `trial_ends_at = start_date + 14 days`. No renewal date is set.
- **AC4 — One trial per hotel:** A hotel can be on the trial plan **once**. Attempting to re-assign the trial plan to a hotel that previously had a `trial` subscription returns `409 Conflict` ("Trial already used"). Super Admin (`*`) can override with an explicit `force: true` flag, which is audit-logged.
- **AC5 — Duration editable:** An admin with `plans.update` can change `trial_duration_days`; the change applies to **new** trials only — running trials keep their original `trial_ends_at`.
- **AC6 — Visibility:** The trial plan appears in the hotel onboarding plan selection, clearly badged as "14-day trial" in both EN/AR.

---

## Story 4.10 — Trial Expiry Handling

**As the** platform owner,
**I want** trials to expire automatically and gracefully after 14 days,
**so that** hotels either convert to a paid plan or lose access without manual intervention.

### Acceptance Criteria

- **AC1 — Expiry job:** A scheduled job (daily) transitions subscriptions where `trial_ends_at < now` from status `trial` to `expired`.
- **AC2 — Tenant lockout behavior:** When a subscription is `expired`, the tenant dashboard becomes **read-only**: staff can log in and view existing data, but all create/update/delete actions and the Guest App for that hotel are disabled. No tenant data is deleted.
- **AC3 — Expiry banner:** Expired tenants see a persistent banner (EN/AR) prompting them to contact the platform to choose a paid plan.
- **AC4 — Countdown warnings:** During the trial, the tenant dashboard shows a remaining-days indicator; at 7, 3, and 1 day(s) remaining, a notification is recorded for the hotel owner (delivery channel — email/in-app — is defined in the Notifications epic).
- **AC5 — Conversion:** An admin with `subscriptions.update` converts an expired or running trial to a paid plan via the existing plan-change flow (Story 4.7). On conversion, status becomes `active`, full access is restored immediately, and the trial subscription record is closed with an end date.
- **AC6 — Super Admin extension:** Super Admin (`*`) can extend a running trial's `trial_ends_at` (e.g., +7 days for a promising lead). The extension is audit-logged as `subscription.trial_extended` with old/new dates.
- **AC7 — Admin visibility:** The Plans list and hotel subscription views (Stories 4.1, 4.6) surface trial status: trials in progress show days remaining; the subscription status enum now includes `expired`.

---

## Notes & Dependencies

- **Depends on:** Epics 01–03 (Auth, Admin Management, Roles & Permissions) — permission catalog and guards are reused as-is.
- **Blocks:** Hotels (Tenants) Management epic — hotel creation requires selecting a plan (or auto-assigning the default per Story 4.8).
- **Module catalog:** The platform module catalog (`transportation`, `housekeeping`, `fnb`, `guest_app_branding`, `analytics`, ...) should live as a single source-of-truth constant/table, mirroring the pattern of the central permission catalog.
- **Seeded plans at launch:** Two plans — "Standard" (Story 4.8) and "Free Trial" (Story 4.9). Hotel onboarding will typically start hotels on the trial.
- **Depends on (partial):** Story 4.10 AC4 notification delivery depends on a future Notifications epic; the countdown indicator and status transitions do not.
- **Out of scope for this epic:** Payment gateway integration, invoicing, and automated billing — subscriptions here are administratively managed. Billing automation is a future epic.
