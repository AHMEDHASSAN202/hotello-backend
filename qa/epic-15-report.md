# QA Report — Epic 15: Guest Requests (End to End)

- **Suite:** `hotello-backend/qa/tests/epic-15/` (Playwright, 4 spec files, 29 tests)
- **Surfaces under test:** hotello-backend (public guest tree + tenant requests/catalog), hotello-guest-frontend (`:3002`, real browser for submit/track/empty-catalog flows)
- **Stack:** local dev stack, migrations + seed applied
- **Result: 29 passed / 0 failed.** One carried **major** finding re-confirmed at three levels (QA-14-001) and one new minor API-contract finding (QA-15-001).

---

## Findings

### QA-14-001 (carried, upgraded in impact) — pre-Epic-14 plans lack `requests`; the whole module is locked for them

- **ID:** QA-14-001 (originally raised in the Epic 14 report as a data/migration gap; the Requests epic proves the impact is larger)
- **Severity:** major
- **Where it bites (all verified in this suite):**
  1. Guest App: the Requests tile never renders (module missing from `enabledModules` on the profile).
  2. Guest API: `GET /guest/catalog` → `403 MODULE_NOT_ENABLED`.
  3. Tenant API: `GET /tenant/requests` and `/tenant/request-catalog` → `403 MODULE_NOT_ENABLED`.
- **Root cause:** the seeded Standard/Free Trial plan rows predate the `requests` module key; seeds are find-or-create and never refresh `enabled_modules`.
- **Evidence:** `qa/tests/epic-15/15-3-board-lifecycle.spec.ts` › module-gating test (fresh hotel on the seeded plan → both surfaces 403), plus every suite in this epic needing explicit `createFullModulePlan` provisioning to run at all.
- **Repo/area:** hotello-backend seed / backfill migration. All newly created plans behave correctly.

### QA-15-001 — open-tab board ignores `categoryId` / `floor` / `assigneeId` / `overdue` query params

- **ID:** QA-15-001
- **Severity:** minor
- **Acceptance criterion touched:** 15.4 AC2 ("Filters: status, category, floor, assignee, overdue-only") — the DTO documents them for the open tab (its comment explicitly calls `overdue` a "server-side overdue-only filter").
- **Steps to reproduce:**
  1. Create an open request with `dueAt` in the past (SQL time-shift, as the auto-checkout era will not produce one yet).
  2. `GET /tenant/requests?overdue=1` → the response includes **all** open requests (not just overdue); same for `categoryId`/`floor`/`assigneeId` — accepted, unapplied.
- **Expected vs actual:** per the DTO documentation, server-side filtering; actual: only `hotelId` + open-status (+ `updatedSince`) are applied on the open tab. The **history** tab applies category/assignee/floor/status server-side, and `counts.overdueNow` is correctly computed — the product's own tenant UI is unaffected (it filters the open board client-side and only server-filters history), which is why this is minor.
- **Failing test:** `qa/tests/epic-15/15-3-board-lifecycle.spec.ts` › `15.4 AC2 — board filters…` (asserts the implemented contract: open-tab = client-side, history-tab = server-side, `counts.overdueNow` correct).
- **Repo/area:** hotello-backend — `tenant-requests.service.ts` `listBoard` (params validated by the DTO but never read).

### Observations

1. **Items with options require the option value** (`400 REQUEST_OPTION_INVALID`) — towels (quantity 1–4) and wake-up call (time) cannot be submitted bare. The guest UI always sends them via the submit sheet; API consumers must too.
2. **Open-board overdue float is client-side** (`board-core.ts` — amber ≥80%, red + float past `dueAt`); the server stores `dueAt`/`slaTargetMinutes` and computes `counts.overdueNow` (both verified). The float ordering itself is covered by the frontend's own `board-core` tests, not this E2E suite.
3. Guest JWTs (15 min, no refresh) make long-running guest sessions re-enter by code — by design; suites mint fresh sessions per test.

---

## Coverage matrix (AC → tests)

| AC | What was tested | Where |
|---|---|---|
| 15.1 AC1 | Seeded catalog reaches the guest translated (4 ru category names, towels item), tenant view with `names` maps, icons, SLA targets, 16 items across 4 categories | 15-1 |
| 15.1 AC2 | Disable/re-enable item hides/restores it for guests; SLA adjust per hotel; platform translations read-only (`403 CUSTOM_ITEM_ONLY`) | 15-1 |
| 15.1 AC3 | Option config: towels quantity 1–4, wake-up time option; quantity out-of-range → 400; submitted value stored | 15-1, 15-2 |
| 15.1 AC4 | Custom item: AR+EN required (400 otherwise), created as `isCustom`, ru guests see the EN fallback | 15-1 |
| 15.1 AC5 | Snapshot: disabling items / catalog edits never rewrite an existing request's name | 15-2 |
| 15.1 AC6 | `request_catalog.updated` audit with a diff (hotel scoped via metadata) | 15-1 (DB verification) |
| 15.2 AC1 | Requests tile live in the Guest App (opens the catalog) | 15-4 (UI) |
| 15.2 AC2 | Browse in the guest language (EN + ru fallback for custom items) | 15-1, 15-4 |
| 15.2 AC3 | Submit: status `new`, item snapshot, note stored, quantity option flow, bottom-sheet UI flow | 15-2, 15-4 |
| 15.2 AC4 | Room binding: request lands on the stay's room; the guest never types it | 15-2 (tenant board cross-check) |
| 15.2 AC5 | Open throttle: 5 open → 6th `429 REQUEST_LIMIT_OPEN` (limit echoed); cancelling frees a seat; daily: 15/day → `429 REQUEST_LIMIT_DAILY` | 15-2 |
| 15.2 AC6 | Module gating: plan without `requests` → tile hidden + guest catalog 403 + tenant board 403; fully disabled catalog → warm "contact the front desk" screen | 15-3 (API), 15-4 (UI) |
| 15.3 AC1/AC2 | My-requests list + tenant detail: snapshot name, note, status, timeline presence | 15-2 |
| 15.3 AC3 | Guest cancel while `new` only; lands `cancelled` with reason `guest`; after `in_progress` refused | 15-2, 15-3 |
| 15.4 AC1 | Board: open requests newest-first, room + guest + status on cards, history tab permanent records | 15-3 |
| 15.4 AC2 | Open tab returns full open set (client-side filtering contract); history tab applies category/floor/status server-side; assignee filter verified on the assigned row | 15-3 (see QA-15-001) |
| 15.4 AC3 | Delta polling: `updatedSince` returns changed rows + `counts` + `serverTime` cursor | 15-3 |
| 15.5 AC1 | `new → in_progress` (auto-assigns the actor) → `done`; final states refuse further transitions; staff cancel reason matrix (`other` requires a note) | 15-3 |
| 15.5 AC2 | Assignees options endpoint; assign stores the assignee; `requests.assign`-less user → 403; assignee filter | 15-3 |
| 15.5 AC3 | Tenant detail endpoint (timeline carrier) verified reachable + hotel-scoped | 15-2/15-3 |
| 15.5 AC4 | `request.created` (guest-attributed) / `request.started` / `request.completed` audits | 15-3 (DB verification) |
| 15.6 AC1/AC2 | SLA snapshot + `dueAt` on the request; open past-due request counted in `overdueNow`; cancelled exits SLA (count drops) | 15-3 |
| 15.6 AC3 | Board counts shape: `open` / `doneToday` / `overdueNow` | 15-3 |

---

## Criteria NOT testable end-to-end (and why)

| AC | Reason |
|---|---|
| 15.4 AC3 — liveness feel (arrival animations, nav badge, toggleable sound) | The polling **endpoints** are verified (deltas + counts); animation/sound are interaction-layer qualities. |
| 15.2 AC5 — duplicate-tap protection | Client-side in-flight button disable; a true double-tap race is a timing-level UI test (the suite covers the server limits instead). |
| 15.5 AC3 — timeline rendered in hotel timezone | Visual rendering of stored timestamps; the timeline carrier (detail endpoint) is verified. |
| Note machine translation, scheduled requests, photo attachments, WebSocket push | Explicitly deferred by the spec. |
| Tenant board UI deep assertions | Covered by the tenant repo's component tests (`requests-page.test.tsx` etc.); this suite covers the guest UI + full API surface. |

---

## Harness notes for future epics

- `qa/helpers/requests.ts` exposes `guestCatalog`, `submitOk` (auto-fills required option values), `guestCancel`, `board`, and catalog finders keyed on `names.en`.
- Request throttles are PER STAY — throttle tests must use their own stay, not the shared worker hotel.
- Catalog tests need explicit plans (`createFullModulePlan`) — see QA-14-001.
