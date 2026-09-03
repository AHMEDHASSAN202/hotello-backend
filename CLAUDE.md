# CLAUDE.md — GXP Backend

GXP (Guest Experience Platform): multi-tenant SaaS for hotels. This NestJS + PostgreSQL + TypeORM backend serves ALL surfaces: Super Admin dashboard, Tenant (hotel) dashboards, and later the Guest App and Staff Task PWA. Epic markdown files are the source of truth for features; this file is the standing law between them.

## Architecture rules

- Thin controllers, all business logic in services. DTOs with class-validator on every endpoint.
- Two route trees, two auth strategies, never mixed: admin routes (platform admins JWT) and tenant routes (tenant users JWT, distinct audience/secret). An admin token must never pass a tenant guard or vice versa.
- **Tenant isolation is the #1 correctness concern:** `hotel_id` comes from the authenticated JWT only — never from client input. Every tenant-scoped query filters by it at the service layer. Cross-tenant access returns **404** (never 403 — don't confirm other tenants' resources exist).
- Tenant access checks run in this order: hotel active → subscription state → module enabled (plan `enabled_modules`) → permission. One `TenantAccessService` answers all of these; evaluated per request (short in-memory cache OK), never baked into JWTs.
- Read-only enforcement (expired trial): block mutations on tenant routes except auth/profile/change-password. Use `@SubscriptionExempt` for deliberate exceptions and keep them rare.

## Permissions (RBAC)

- Two **separate** code-versioned catalogs: platform (`admins.*`, `plans.*`, `hotels.*`, ...) and tenant (`staff.*`, `roles.*`, `rooms.*`, ...). Never merged, never cross-imported into guards.
- Unknown permission keys **fail closed** (deny + warning log).
- Wildcard `*`: platform Super Admin; tenant Owner (tenant-scoped). Owner role is `is_system` — never editable/deletable/strippable.
- Escalation guard on tenant role editing: a user can only grant permissions they themselves hold.
- New module = register its permissions in the catalog first; matrix UIs render from the catalog.

## Data rules

- **No hard deletes** for business records: statuses instead (`archived`, `disabled`, `inactive`, `suspended`). Roles without history are the only exception.
- Append-only history where money/audit is involved (subscriptions: close row + open row, never overwrite).
- Guard violations return **409 with details** (what's violated, counts). Super Admin `*` may override with explicit `force: true` — always audit-logged. Tenant-side actions get no force override (hotels upgrade their plan instead).
- Confirmed business decisions (do not re-ask): owner does NOT count toward `max_staff_users`; `pending` invites reserve seats; re-enabling staff re-checks the seat limit (409 if over); room count = `active` + `out_of_service` rooms (derived, `declared_rooms_count` is reference-only); trial = one per hotel; suspension fully locks (no login), expired trial = read-only — two distinct states.
- Every mutation emits an audit event (`entity.action`, with diff where relevant) via the existing audit mechanism.
- Seeds are idempotent and hooked into onboarding where per-hotel (default roles, room types).

## Tokens & credentials

- Setup/reset/invite tokens: hashed at rest, single-use, env-configurable expiry, regeneration invalidates prior ones. Raw values exist in memory only and are shown/sent exactly once — never in logs, audit entries, or queryable columns; masked in any preview.
- Tenant identity: at least one of email OR username (username: lowercase, 3–30, `[a-z0-9._-]`, no `@`, unique per hotel). Login input with `@` = email lookup, else username — within the resolved tenant. Owner is always email-based. Username-only accounts can't self-reset — manager reset sets a one-time temp password + `must_change_password`.

## Notifications

- Outbox pattern: persist before send; `pending → sent | failed`; retries with backoff; never fire-and-forget.
- Event-driven: business services emit events; the notifications module listens, renders, sends. A notification failure must never fail the emitting business operation.
- Templates are **typed TypeScript functions** (no MJML/Handlebars/React Email): table-based HTML, inline CSS, `dir="rtl"` for Arabic. Missing variable = render error = `failed`, never a half-rendered send.
- Idempotency keys (unique constraint) per event occurrence — double-emit creates one record.
- Language resolution lives in ONE function: user `preferred_language` → hotel `default_language` → `ar`.

## Infrastructure patterns

- Pluggable drivers via env, one interface each: `STORAGE_DRIVER=local|s3` (store keys in DB, never full URLs), `MAIL_DRIVER=log|smtp`.
- Tenant URLs computed from env (`TENANT_BASE_DOMAIN` → `{slug}.domain`; `GUEST_APP_BASE_URL/{slug}?room=N`), never stored. Slug: kebab-case, 3–40, reserved-words list, immutable except `*` (audit-logged).
- Scheduled jobs (trial expiry, outbox retry) are idempotent; no Redis/BullMQ unless already present.
- QR codes and generated PDFs/Excel are derived on demand — never persisted. PDFs via Playwright + Noto fonts (RTL-correct); Excel via a lib supporting header comments + data-validation dropdowns.
- Schema changes: migrations are set up in this repo (`src/data-source.ts`, `migration:*` scripts, `synchronize: false`) — every entity change ships its migration in the same PR, no exceptions. Migrations are hand-written; FK/constraint names must match the TypeORM hashes and `npm run migration:check` must report no drift.

## Errors & i18n

- API errors surfaced to UIs carry **stable error codes** (frontends own the translated wording). Add codes only for errors a UI actually shows.
- Anything guest- or hotel-facing is bilingual AR/EN minimum (data fields `_en`/`_ar`); Guest App content will later need 7 languages (ar, en, ru, fr, it, es, de) — don't hardcode locale lists in more than one place.

## Quality bar

- Service-layer unit tests minimum for every epic: guards, races (seat/room limits), token lifecycles, isolation (cross-tenant 404), idempotency. TypeScript build clean — always.
- Reuse existing mechanisms (password policy, lockout, audit, token hashing, language resolution) — extending beats duplicating, duplication is a review failure.

## Specs

Feature specs live in this repo under `/specs`. Before planning or implementing any
feature, read its epic file fully — it is the source of truth. Durable decisions made
during Q&A go back into the epic file.

## Workflow (pre-production convention — revisit at launch)

- All work happens directly on `master`. No feature branches, no stacked epic
  branches, no worktrees.
- Small, clear commits per task; push to origin after each verified green
  state — `origin/master` always holds the latest work.
- Quality gates never relax: full test suite + `npm run build` +
  `npm run migration:check` must be green before every push. Never push red.
- Changes spanning repos land backend-first, then the frontends.


## Model Discipline (execution workflow law)

This project runs a fixed model assignment per phase. These are standing
rules, not suggestions:

1. **Planning** runs on the strongest available model (Fable-class). Plans
   read the epic spec + this file fully before proposing anything.

2. **Execution** (implementing plan tasks) runs on Sonnet. Per-task reviews
   and their fix rounds also run on Sonnet — they verify task-level
   correctness, not architecture.

3. **Final whole-epic review is a hard checkpoint:** when all plan tasks
   (including fix rounds) are complete and the epic is otherwise ready,
   STOP before starting the final review. Announce: "Ready for final
   review — switch the model now." Wait for the user to switch (they will
   run /model) and confirm before proceeding. Never run the final
   whole-epic review on the execution model, and never skip it.

4. **The final review re-verifies from scratch:** every acceptance
   criterion in the epic spec, cross-cutting concerns (tenant isolation,
   permission gating, i18n parity, budget/perf gates), and consistency
   with this file's conventions. It does not trust per-task review
   conclusions — it re-checks. Findings are classified must-fix vs
   recommendation; must-fixes land before push.

5. **After final-review fixes**, the fix verification may run on the
   execution model, but any NEW must-fix found during verification
   re-triggers rule 3.

6. If a mid-session model switch happens for any other reason (e.g., a
   flagged-message fallback), note it in the final report so the user
   knows which phases ran on which model.