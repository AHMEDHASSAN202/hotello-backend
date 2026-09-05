# QA E2E Runbook — read before writing suites

You are extending the GXP E2E QA suites in `hotello-backend/qa/`. Rules: tests
+ reports ONLY. Never modify application code in any repo. Never modify shared
harness files (`helpers/*`, `fixtures.ts`, `playwright.config.ts`) — import
them, and put any epic-specific helpers in your own `tests/epic-NN/helpers.ts`.
Do NOT `git commit` — the orchestrator commits after review.

## Environment

- Stack: backend `http://localhost:4000/api/v1`, tenant app `:3001`, guest app `:3002`
  (guest hotels at `http://localhost:3002/{slug}`), Postgres in docker (`hotello-db`).
- Super Admin: `admin@hotello.app` / `ChangeMe123` (see `helpers/gxp-api.ts`).
- Helpers you must reuse (read them first):
  - `helpers/gxp-api.ts` — admin/tenant auth, `provisionHotel` (onboards hotel +
    owner via the real flows), `createPlan`, `createFullModulePlan`, room helpers.
  - `helpers/stays.ts` — `checkInOk` (returns stay + plaintext code), guest
    session helpers, `guestSessionSteady`.
  - `helpers/guest-ui.ts` — guest UI session seeding (localStorage `gxp_guest_token`).
  - `helpers/tenant-ui.ts` — tenant UI login/session.
  - `helpers/requests.ts` — requests catalog/board/lifecycle (Epic 15 pattern —
    copy this file's structure for your epic's helpers, in YOUR tests dir).
  - `helpers/db.ts` — `sql`, audit lookups, `deleteQaHotels`.
  - `fixtures.ts` — `test`/`expect` + worker-scoped `hotel`, `adminToken`,
    `standardType` fixtures.
- Run: `cd hotello-backend/qa && GXP_CLEANUP_PREFIX=qa-e16- npx playwright test tests/epic-16 --workers=2`
  (use YOUR epic's prefix; the cleanup only deletes hotels with slugs starting
  with it — parallel agents rely on this).
- Typecheck before declaring done: `npx tsc --noEmit -p tsconfig.json`.

## Hard-won pitfalls (do not rediscover these)

1. **Seeded plans are stale** (QA-14-001): the seeded Standard plan lacks
   `requests`/`guest_app_branding`/`events` module keys. Any test touching a
   module must `createFullModulePlan(request, adminToken, name)` and provision
   with that planId.
2. **Timezone**: `provisionHotel` pins `timezone: 'UTC'`. Keep it — date math
   in helpers assumes UTC (`todayPlus` uses toISOString).
3. **Response shapes**: some list endpoints return BARE arrays
   (`/tenant/stays/available-rooms`, `/tenant/requests/assignees`, `/plans`,
   `/tenant/request-catalog` is `{categories}`; check each). When a `.map`
   fails on undefined, log the raw body before assuming a product bug.
4. **jsonb in audit metadata renders with spaces** (`"count": 2`) — parse it
   (`JSON.parse`) instead of substring matching. Audit `entityId` is sometimes
   the CHILD entity (room.created → room id) with hotelId only in metadata —
   use `auditCountByMeta`/`lastAuditMetaByMeta` then.
5. **Masked secrets**: outbox rows persist MASKED renders — the plaintext
   code/token is never at rest. Assert absence, not presence.
6. **Guest JWTs live 15 min, no refresh** (re-entry by code). Mint fresh
   sessions per test in long suites. Multi-device logins in the same second
   produce byte-identical tokens — assert validity, not inequality.
7. **Login pacer**: all auth logins go through a shared cross-process pacer
   (5/min/IP product throttle). Long runs are pacing-bound; do not remove it,
   do not hammer login endpoints with raw curl during runs.
8. **Guest route throttle**: `/guest/*` = 30/min/IP shared across ALL workers
   (generic 429 without a code — infrastructure). Retry those; the layered
   brute-force limits (TOO_MANY_ATTEMPTS + retryAfterSeconds) are REAL
   behavior — test them only against dedicated hotels (they poison the bucket
   for an hour).
9. **Throttles/limits are per-stay or per-hotel** — read the service before
   assuming scope (request limits are per-stay; stay-code uniqueness per hotel;
   trial one-per-hotel EVER).
10. **Tenant catalog / board** use `names` translation maps (not `nameEn`),
    and the open board filters client-side (history filters server-side).
11. **fullyParallel is on**: tests within a file may run in DIFFERENT workers
    (each runs `beforeAll` → its own hotel via module state). Never write
    cross-test assertions over shared worker-hotel state unless the file is
    `test.describe.configure({ mode: 'serial' })` (only for accounting-order
    suites like rate limits).
12. **Verify before reporting**: when a test fails, reproduce the flow with a
    raw API probe (curl or a throwaway spec) and read the service code. A
    false report costs more than a missed one. Fix the test if the test was
    wrong; report the bug (do not fix code) if the product was wrong.
13. **Determinism**: unique slugs per run via `qaSlug` (keep your epic's
    prefix), seed everything through the real API, clean expectations — no
    arbitrary sleeps except documented cache/throttle windows (say which).

## Report format (`qa/epic-NN-report.md`)

- Header: suite path, surfaces, stack, result (X passed / Y failed).
- Findings: ID (QA-NN-00X), severity (blocker/major/minor/cosmetic), AC
  violated (e.g. "16.5 AC3"), steps to reproduce, expected vs actual,
  failing test file + name, repo/area guess, verification performed.
  Observations (no AC violated) go in their own subsection.
- Coverage matrix: every AC → what was tested + which spec file, or why it is
  NOT testable E2E (be specific: production-only, human-review gate, deferred,
  no trigger endpoint…).
- Harness notes for the next epics.
