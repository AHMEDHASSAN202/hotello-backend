# Epic 08 — Tenant Dashboard: Authentication & App Foundation

> **Scope:** First epic of the **Tenant (Hotel) Dashboard** — a **separate Next.js app** (per project convention: one frontend project per dashboard) served per-tenant via subdomain (`{slug}.TENANT_BASE_DOMAIN`) with path prefix (`/t/{slug}`) fallback. Covers tenant resolution, owner account activation (consuming the setup-link endpoint built in Epic 05), login, password reset, sessions, and subscription-state enforcement (trial banner / read-only / suspended lock from Epics 04–05).
>
> **Backend:** same NestJS backend (no new service) — tenant endpoints live alongside admin endpoints with a separate auth strategy for tenant users.
>
> **Tenant permission catalog (introduced here, managed fully in Epic 10):** tenant-scoped, separate from the platform catalog. Owner holds tenant wildcard `*` (seeded in Epic 05).

---

## Story 8.1 — Tenant Resolution & App Shell

**As a** hotel staff member,
**I want** my hotel's dashboard at my hotel's own URL,
**so that** I always land in my hotel's context.

### Acceptance Criteria

- **AC1 — Resolution:** The app resolves the tenant from the subdomain first, then from the `/t/{slug}` path prefix. Unknown slug → a branded 404 ("hotel not found") page.
- **AC2 — Context everywhere:** All API calls carry the resolved tenant context; the backend derives the authoritative `hotel_id` from the authenticated user — never trusts a client-sent hotel id.
- **AC3 — Hotel branding basics:** The shell shows the hotel's name and logo (from Epic 05 profile) in the sidebar/top bar, alongside platform brand tokens (navy `#0E2A47`, gold `#C8A24A`).
- **AC4 — Suspended hotel:** A `suspended` hotel's URLs render the locked "unavailable" page (Epic 05, Story 5.5 AC3) — login itself is blocked with a clear message; no staff can authenticate.
- **AC5 — i18n-ready:** The app ships with the AR/EN i18n foundation from Epic 07 (same libraries/pattern, own locale files) from day one — no hardcoded strings.

---

## Story 8.2 — Owner Account Activation (Setup Link)

**As a** hotel owner who received a setup link,
**I want** to set my password and activate my account,
**so that** I can access my hotel's dashboard.

### Acceptance Criteria

- **AC1 — Setup page:** Opening a valid setup link shows a set-password form (name + hotel shown read-only). Consumes the existing public endpoint (`POST /tenant-users/setup`, Epic 05) — token semantics unchanged: hashed at rest, 72h expiry, single-use.
- **AC2 — Password policy:** Same policy as platform admins (reuse the existing validation rules and strength indicator pattern).
- **AC3 — Outcomes:** Success → account `pending` → `active`, auto-login into the dashboard. Expired/used/invalid token → clear error with instructions to request a new link from the platform (no token enumeration hints).
- **AC4 — Rate limiting:** The setup endpoint is rate-limited (already required by Epic 05 note 5 — verify it's in place).

---

## Story 8.3 — Tenant Login

**As an** activated hotel user,
**I want** to log in to my hotel's dashboard,
**so that** I can do my job.

### Acceptance Criteria

- **AC1 — Scoped login:** A single identifier field accepts **email or username** + password, authenticating **within the resolved tenant only** (input containing `@` is treated as email, otherwise as username). Usernames are unique per hotel; the same username or email at another hotel is a different account; credentials never cross tenants. (Username accounts are created via Epic 09, Story 9.7.)
- **AC2 — Status checks:** `disabled` users cannot log in; users of a `suspended` hotel cannot log in (Story 8.1 AC4). Generic error messages (no user-existence leaks).
- **AC3 — Tokens:** JWT carries tenant-user identity with `hotel_id` and tenant permissions; **distinct audience/strategy from platform-admin JWTs** — an admin token is never valid on tenant endpoints and vice versa.
- **AC4 — Brute-force protection:** Same lockout/rate-limit behavior as platform admin login (reuse the mechanism).
- **AC5 — Last login:** `last_login_at` is recorded (surfaces in Super Admin's Owner tab, Epic 05, and Staff list, Epic 09).

---

## Story 8.4 — Password Reset

**As a** hotel user who forgot their password,
**I want** to reset it by email,
**so that** I can regain access without contacting anyone.

### Acceptance Criteria

- **AC1 — Request:** "Forgot password" on the tenant login page sends a reset email via the Epic 06 pipeline (new outbox type `tenant_password_reset`, new typed-TS template AR/EN following the hotel user's language — see note 6). Response is identical whether the email exists or not.
- **AC2 — Token semantics:** Reset tokens mirror setup tokens: hashed at rest, single-use, short expiry (env, default 2h), new request invalidates prior tokens.
- **AC3 — Reset flow:** Valid token → set new password → all existing sessions for that user are invalidated → confirmation screen → login.
- **AC4 — Suspended hotel:** Reset requests for users of suspended hotels are accepted silently but no email is sent (no state leak).
- **AC5 — Username-only accounts:** Accounts without an email cannot self-reset. The "forgot password" screen states (AR/EN) that accounts using a username should ask their manager to reset it (manager-side reset: Epic 09, Story 9.8). Submitting a username-shaped input into the reset form returns the same silent-success response (no account-type leak).

---

## Story 8.5 — Session, Logout & Guards

**As the** platform owner,
**I want** tenant sessions governed by the same security standards as the admin dashboard,
**so that** tenant access is consistently protected.

### Acceptance Criteria

- **AC1 — Guards:** Global JWT guard (tenant strategy) + tenant Permissions guard on all tenant endpoints, mirroring the platform pattern. Permission checks evaluate the tenant catalog; owner `*` passes everything tenant-scoped.
- **AC2 — Tenant isolation (critical):** Every tenant query is filtered by the authenticated user's `hotel_id` at the service layer. Cross-tenant access attempts return `404` (not `403` — don't confirm existence of other tenants' resources).
- **AC3 — Logout:** Explicit logout invalidates the session per the existing token strategy; expired tokens redirect to the tenant's login page preserving the intended destination.

---

## Story 8.6 — Subscription-State Enforcement

**As the** platform owner,
**I want** the tenant dashboard to reflect the hotel's subscription state,
**so that** trial, expiry, and suspension behave exactly as specified in Epics 04–05.

### Acceptance Criteria

- **AC1 — Trial banner:** Hotels on `trial` see a persistent countdown banner (days remaining) — fulfilling Epic 04, Story 4.10 AC4's dashboard indicator.
- **AC2 — Expired = read-only:** `expired` subscription → dashboard is read-only: all views work, every mutating action is disabled in the UI **and** rejected by the backend (guard returns a specific error code the UI maps to a translated explanation + conversion prompt banner).
- **AC3 — Module gating:** Navigation and routes for modules not in the hotel's plan (`enabled_modules`, Epic 04) are hidden/blocked. Gating is enforced backend-side too (plan check in the guard), not just visually.
- **AC4 — Live transitions:** State changes (trial→expired, plan change, suspension) take effect on the next request without redeploy — state is evaluated per request/short-cache, not baked into the JWT.

---

## Story 8.7 — My Profile

**As a** hotel user,
**I want** to manage my own profile,
**so that** my details and preferences stay current.

### Acceptance Criteria

- **AC1 — Editable:** Own name, password (current-password required), and `preferred_language` (`ar`|`en`, default follows the hotel's `default_language` on first login).
- **AC2 — Not editable:** Own email, role, and permissions (managed via Epics 09–10).

---

## Implementation Notes for Claude Code

Follow existing conventions (NestJS clean architecture; thin controllers; service-layer logic; typed-TS email templates from Epic 06; i18n pattern from Epic 07; brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **New frontend project** (e.g., `gxp-tenant-dashboard`), same stack/tooling as the admin frontend. Reuse the i18n setup pattern (Epic 07) — copy the pattern, not a shared package, unless a shared package already exists.
2. **Same backend, second auth strategy:** add a tenant JWT strategy (separate secret or audience claim) + `TenantPermissionsGuard`. Keep admin and tenant route trees clearly separated (e.g., `/api/admin/...` existing vs `/api/tenant/...`). Never mix guards.
3. **Tenant isolation is the #1 correctness concern:** derive `hotel_id` from the JWT only; service methods take it as an explicit parameter; write tests proving cross-tenant reads/writes fail with 404. Consider a request-scoped tenant context to avoid parameter drilling, but keep it explicit at repository call sites.
4. **Subscription/module gating as one guard/service:** single `TenantAccessService` answering: is hotel active? subscription state? module enabled? — used by both a global guard (read-only/suspension enforcement via error codes) and per-route module metadata. Evaluate per request with a short in-memory cache (seconds), satisfying 8.6 AC4.
5. **Read-only enforcement:** block HTTP mutations (POST/PATCH/DELETE) on tenant routes when `expired`, excluding auth/profile routes (login, password reset, logout, own profile must still work).
6. **Language for reset emails:** tenant users get `preferred_language`; fall back to hotel `default_language`. Extend Epic 06's language-resolution function — don't fork it.
7. **Suspended lock page** is served by the tenant app itself (resolve tenant → status check → static locked view) so URLs "never break" (Epic 05, Story 5.7 AC3).
8. **Reuse, don't duplicate:** password policy, lockout mechanism, audit mechanism (`tenant_user.login`, `tenant_user.password_reset`, etc.), and token hashing utilities all already exist — extend them.
9. **Tests:** tenant isolation (cross-tenant 404s), strategy separation (admin JWT rejected on tenant routes and vice versa), read-only guard matrix, suspended login block, reset-token lifecycle, module gating. Keep the TypeScript build clean.

---

## Design Notes for Claude Code — This Dashboard Is the Product

The hotels are our **paying clients**, and the Tenant Dashboard is what they see every day — it must feel like a polished commercial product, noticeably more refined than an internal admin tool. Since this epic creates the app shell, layout, and design system that **every future tenant module inherits**, invest the design effort here, once, properly:

1. **Establish a real design system in this epic:** typography scale, spacing rhythm, color usage (navy `#0E2A47` as primary, gold `#C8A24A` as accent — used deliberately and sparingly, not splashed everywhere), border radii, elevation/shadows, button hierarchy (primary/secondary/ghost/destructive), form field states (default/focus/error/disabled), and a consistent component vocabulary. Future module epics must be able to reuse these tokens/components without redefining anything.
2. **Hotel-first branding:** the hotel's own name + logo take visual priority in the shell (sidebar/top bar) — the hotel should feel this is *their* system, with GXP as the quiet platform underneath ("Powered by GXP" footer, not a competing brand presence).
3. **Craft the details that signal quality:** designed empty states (illustrated or well-composed, with a clear CTA — never a blank table), skeleton loading states (no layout jumps or spinner-only pages), smooth micro-transitions (dropdowns, modals, banner enter/exit), and meaningful error states with recovery actions. The trial countdown banner and read-only/conversion banners (Story 8.6) deserve real design attention — they are conversion surfaces, not warnings.
4. **The auth screens are the first impression:** login, setup/activation, and password-reset pages should look like a premium SaaS product — composed layout, hotel branding where resolvable, polished in **both** languages.
5. **RTL as a first-class design target:** Arabic isn't a mirrored afterthought — check visual balance, typography (an Arabic font pairing that matches the Latin one in weight/feel, e.g., a Noto/IBM Plex Arabic pairing consistent with what the PDFs already use), and alignment quality in RTL explicitly.
6. **Responsive down to tablet:** front-desk staff will use this on tablets and sometimes phones. The shell (collapsible sidebar), tables (responsive strategy — horizontal scroll with pinned key column, or card collapse), and forms must work at those sizes. Desktop-first, tablet-verified.
7. **Accessibility floor:** WCAG AA contrast (verify gold-on-white usage — gold text on white likely fails; use it on navy or as non-text accent), visible focus states, correct form labeling.

---

## Notes & Dependencies

- **Depends on:** Epics 04–07 (subscription states, setup tokens + public endpoint, notifications pipeline + typed templates, i18n pattern). The migrations task should be done before this epic's backend work begins.
- **Blocks:** Epic 09 (Staff Management), Epic 10 (Tenant Roles), and all tenant operational modules.
- **Deferred:** 2FA, SSO, remember-me refinements — revisit post-MVP.
