# QA Report — Epic 22: Reports & Analytics (Performance Smoke Test)

- **Type:** Performance smoke test (Implementation Note 1), not a functional
  QA pass — Stories 22.1-22.6's functional coverage lives in each task's Jest
  unit suite (Tasks B1a-B4b), reviewed task-by-task.
- **Seeded volume:** 50 rooms (5 floors x 10), 331 stays (19 active / 312
  checked_out), 319 guest requests, 297 F&B orders / 607 order lines, 8
  events / 95 event bookings, 1,373 housekeeping events, 12 stay room
  changes — over a 90-day window (2026-06-06 .. 2026-09-03).
- **Stack:** local dev stack, Postgres 16 via docker compose (port 5433),
  migrations applied through `1787300000000-ReportsFoundation`, called
  directly via `NestFactory.createApplicationContext` (no HTTP layer, no
  JWT — pure service/query timing).
- **Budget:** ~500ms per report call (Implementation Note 1).

## Real module/plan mechanism (verified before writing the seed script)

Per the task brief's instruction to confirm this rather than guess: `Hotel`
(`src/modules/hotels/hotel.entity.ts`) has **no** module or plan column of
its own. Module access is:

```
Hotel --(1:N, endDate IS NULL = current)--> Subscription --(N:1)--> Plan.enabledModules: string[]
```

`Subscription` (`src/modules/subscriptions/subscription.entity.ts`) is the
join row — a hotel's live subscription is whichever row has `endDate IS
NULL`. `Plan.enabledModules` (`src/modules/plans/plan.entity.ts`) is the
`text[]` column the reports/tenant-access layer actually reads. The seed
script creates a dedicated `QA Epic 22 Perf Plan` with
`enabledModules: ['analytics', 'housekeeping', 'requests', 'fnb', 'events']`
and an `active` `Subscription` row linking the hotel to it (see
`qa/epic-22-perf-seed.ts`, sections 1-3). Tenant permissions are the
code-versioned `DEFAULT_TENANT_ROLES` (`src/modules/tenant-roles/default-tenant-roles.ts`)
— reused as-is (Owner = wildcard `['*']`) rather than reinvented, since Part
2 calls the report **service** methods directly (bypassing HTTP/guards
entirely), so no login or JWT is needed for this task. This matched the
brief's guessed shape exactly — no rework was needed once the entities were
read.

## Results (90-day custom range, `2026-06-06` .. `2026-09-03`)

| Report | Cold (ms) | Warm (ms) | Data volume | Within budget? |
|---|---|---|---|---|
| balances | 42.09 | 25.07 | 3 rows | ✅ |
| leakage | 37.36 | 28.50 | 59 rows | ✅ |
| guests | 36.65 | 18.93 | 90 occupancy-trend days | ✅ |
| requests | 61.69 | 62.53 | 89 volume-days + categories | ✅ |
| housekeeping | 92.47 | 71.68 | 91 cleaned-days + attendants | ✅ |
| dining | 53.32 | 50.93 | 88 revenue-days + top items | ✅ |
| events | 18.24 | 19.01 | 7 event performances | ✅ |
| totals | 63.89 | 48.42 | 82 by-day rows | ✅ |
| overview (incl. revenue) | 212.02 | 193.50 | composite (all of the above) | ✅ |

Raw output of `qa/epic-22-perf-measure.ts` (unedited):

```
Hotel: qa-epic22-perf (699e9504-5b51-41c4-b6e0-4b726d80e9ce)
Seeded stays: 331
Custom report period: 2026-06-06 .. 2026-09-03

--- COLD pass ---
Report                            ms  Data volume  Budget
balances                       42.09  3            OK
leakage                        37.36  59           OK
guests                         36.65  90           OK
requests                       61.69  89           OK
housekeeping                   92.47  91           OK
dining                         53.32  88           OK
events                         18.24  7            OK
totals                         63.89  82           OK
overview (incl. revenue)      212.02  1            OK

--- WARM pass ---
Report                            ms  Data volume  Budget
balances                       25.07  3            OK
leakage                        28.50  59           OK
guests                         18.93  90           OK
requests                       62.53  89           OK
housekeeping                   71.68  91           OK
dining                         50.93  88           OK
events                         19.01  7            OK
totals                         48.42  82           OK
overview (incl. revenue)      193.50  1            OK

=== Summary (cold vs warm) ===
Report                       Cold (ms)   Warm (ms)  Within budget (warm)?
balances                         42.09       25.07  ✅
leakage                          37.36       28.50  ✅
guests                           36.65       18.93  ✅
requests                         61.69       62.53  ✅
housekeeping                     92.47       71.68  ✅
dining                           53.32       50.93  ✅
events                           18.24       19.01  ✅
totals                           63.89       48.42  ✅
overview (incl. revenue)        212.02      193.50  ✅

RESULT: all 9 calls are within the 500ms budget (warm).
```

## Findings

**No findings — every one of the 9 report calls is comfortably under the
500ms budget, both cold and warm, at ~50-room / ~90-day / ~330-stay volume.**
The slowest individual call (`housekeeping`, cold 92ms) is still 5.4x under
budget; the slowest call of any kind (`overview` with revenue included, warm
193ms) is 2.6x under budget. No query is patched or touched in this task —
there is nothing to patch.

One observation worth flagging to the epic owner even though it is not a
blocker: `overview(..., includeRevenue=true)` is the clear outlier at
~190-210ms, 3-10x every other individual call. Reading
`reports-overview.service.ts` explains why — it is a pure composition that
internally calls `operational.requests()` **twice** (current + previous
window, for the honest-delta comparison) and `revenue.dining()`,
`revenue.events()`, `revenue.totals()` **twice each** (same reason), i.e. it
re-runs most of the other 8 measured calls' underlying queries 2x each in a
single request, plus its own occupancy/housekeeping/service aggregation on
top. That is the correct, intentional design (Story 22.1 AC6's "vs previous
period" comparison), not a bug — `Promise.all` is already used to
parallelize the revenue fetches — but it means `overview`'s cost scales
roughly linearly with the cost of `dining`+`events`+`totals`+`requests`
combined. At 50 rooms this is 193ms and nowhere near the budget; if a future
epic increases per-hotel volume by an order of magnitude (500 rooms, a full
year of history), `overview` is the first of the 9 to approach 500ms, not
because of an inefficiency but because it is doing genuinely more work than
any single-report call. Worth a note for whoever revisits Epic 22 performance
at higher volume — not a finding against this task's ~50-room MVP scope.

## Issues hit while seeding (environment gotchas, not product bugs)

1. **`qa/` owns its own `tsconfig.json`** (for the Playwright suite:
   `target: es2022`, `strict: true`, no `experimentalDecorators`/
   `emitDecoratorMetadata`). `ts-node` resolves the nearest `tsconfig.json`
   starting from the **entry script's directory**, not the process's cwd —
   so running `ts-node qa/epic-22-perf-seed.ts` from `gxp-backend/`
   picks up `qa/tsconfig.json` instead of the root one. With
   `useDefineForClassFields` defaulting to `true` under `es2022`, every
   TypeORM entity in the app fails to compile (`TS2564: Property 'X' has no
   initializer` on every `@Column()` field) — this is a real reproducible
   trap for anyone adding scripts under `qa/`, not specific to this task's
   code. **Fix:** force the root config explicitly with
   `TS_NODE_PROJECT=tsconfig.json` (see "How to reproduce" below). Neither
   script's own code needed any change — this is purely an invocation-time
   environment quirk.
2. **The module/plan mechanism guess in the brief was correct** — see the
   "Real module/plan mechanism" section above. No rework was needed.
3. **`Room`/`GuestRequest`/`FnbOrder` unique-active-stay constraint**
   (`UQ_stays_room_active`, partial unique index on `status='active'`)
   required a small in-memory correction pass: naively marking every stay
   whose `checkOutDate` is in the future as `'active'` produces duplicate
   active rows per room across a 90-day, round-robin-cycled room schedule.
   The seed script keeps only the **last** such occurrence per room as
   `'active'` and downgrades earlier duplicates to `'checked_out'` before
   inserting (see `qa/epic-22-perf-seed.ts`'s `lastActiveIndexByRoom` pass) —
   otherwise the bulk insert would fail on the partial unique index.
4. **A plain `DELETE FROM hotels WHERE slug = ...` does not work** — none of
   the tenant-scoped tables cascade on hotel delete (verified: it fails with
   `FK_c2e0f4f70f1911b035c03be1986 on table "tenant_users"` on the first
   attempt). The seed script's own re-run cleanup deletes children in
   dependency order first — see "Cleanup" below for the exact working SQL.

## How to reproduce

```bash
docker ps                                    # confirm gxp-db is up on 5433
npm run migration:run
TS_NODE_PROJECT=tsconfig.json npx ts-node -r tsconfig-paths/register qa/epic-22-perf-seed.ts
TS_NODE_PROJECT=tsconfig.json npx ts-node -r tsconfig-paths/register qa/epic-22-perf-measure.ts
```

(`TS_NODE_PROJECT=tsconfig.json` is required — see Issue 1 above; without it
both scripts fail to compile, not because of anything in the scripts
themselves.)

The seed script is safely re-runnable: it deletes any prior
`qa-epic22-perf` hotel (and every child row) before rebuilding, verified by
running it twice in a row in this session (332 stays / 281 requests on the
first run, 331 stays / 319 requests on the second — different random data,
same successful shape).

## Cleanup

The `qa-epic22-perf` hotel is left in the dev DB intentionally (re-running
the measure script against it costs nothing and lets a future epic re-check
performance after schema/index changes). To remove it, none of the FKs
cascade (verified — a plain `DELETE FROM hotels` fails with a `tenant_users`
FK violation), so children must be deleted first, in this order (the exact
sequence `qa/epic-22-perf-seed.ts`'s own `deleteExistingHotel()` uses):

```sql
DO $$
DECLARE hid uuid;
BEGIN
  SELECT id INTO hid FROM hotels WHERE slug = 'qa-epic22-perf';
  IF hid IS NOT NULL THEN
    DELETE FROM housekeeping_events WHERE "hotelId" = hid;
    DELETE FROM stay_room_changes WHERE "hotelId" = hid;
    DELETE FROM event_bookings WHERE "hotelId" = hid;
    DELETE FROM events WHERE "hotelId" = hid;
    DELETE FROM fnb_order_lines WHERE "hotelId" = hid;
    DELETE FROM fnb_orders WHERE "hotelId" = hid;
    DELETE FROM fnb_items WHERE "hotelId" = hid;
    DELETE FROM fnb_menu_sections WHERE "hotelId" = hid;
    DELETE FROM fnb_menus WHERE "hotelId" = hid;
    DELETE FROM fnb_locations WHERE "hotelId" = hid;
    DELETE FROM requests WHERE "hotelId" = hid;
    DELETE FROM stays WHERE "hotelId" = hid;
    DELETE FROM rooms WHERE "hotelId" = hid;
    DELETE FROM room_types WHERE "hotelId" = hid;
    DELETE FROM tenant_users WHERE "hotelId" = hid;
    DELETE FROM tenant_roles WHERE "hotelId" = hid;
    DELETE FROM subscriptions WHERE "hotelId" = hid;
    DELETE FROM hotels WHERE id = hid;
  END IF;
END $$;
```

The `QA Epic 22 Perf Plan` row in `plans` is intentionally left behind
(shared/find-or-create, harmless, matches the `plans` seed pattern in
`src/database/seeds/seed.ts`).

## Overall assessment — readiness for pilot-hotel real volume

**Ready.** At a volume representative of (and somewhat beyond) a realistic
single pilot hotel's first 90 days — 50 rooms, 331 stays, ~300 F&B orders,
~320 guest requests, ~1,400 housekeeping events — every one of the 9 report
calls the Epic 22 UI will drive comes back in well under 100ms individually
(worst case 92ms cold) and the heaviest composite call (`overview` with
revenue) comes back in ~190ms warm, both far inside the epic's own ~500ms
budget. No index or query changes are warranted by this task's findings.
The only genuine risk surfaced is the `overview` call's multiplicative cost
under the "vs previous period" comparison, noted above as a forward-looking
observation for whichever future task revisits performance at meaningfully
larger scale (multi-hundred-room hotels or multi-year history) — not
something the pilot hotel's expected volume will approach.

## Frontend status (added post-backend-perf-report)

The Epic 22 frontend (gxp-hotel-frontend) shipped across Tasks F1a-F3:
Overview dashboard, all seven report tabs (guests/services/housekeeping/
dining/events/totals/balances), xlsx/CSV exports, the analytics upsell
sample-data preview, and revenue-permission scoping in the UI. Task F3
wired an `ExportButton` into every tab (plus raw-data CSV feed buttons on
guests/services/dining/events) against the real `:report/export` contract
verified here — the `400 REPORT_EXPORT_ROW_LIMIT` shape and the balances
export's period-independent data path both matched this report's
implementation exactly, so no frontend workaround was needed. Combined
with the performance numbers above, the epic is ready for pilot-hotel use;
the only open item is the forward-looking `overview` delta-comparison cost
noted above, which remains a later-scale concern, not a blocker.

## Follow-up tasks (from the frontend final re-review's business-fit pass, 2026-09-03)

Logged in priority order; neither blocks pilot use. Three sibling gaps found
in the same pass (the balances aging column, the hotel-wide outstanding
total, and the "vs same time yesterday" delta label) were judged core to the
balances story and fixed before the frontend push instead of being logged.

1. **Heat-strip hour axis (tablet-first).** The busiest-hours strip renders
   24 unlabelled bars with per-hour info hover-only; on the front desk's
   tablets (no hover) a manager can see the peak callout but cannot place
   the *second* bump — which is the staffing question 22.2's AC asks. Add a
   sparse hour axis (e.g. 00/06/12/18 ticks, localized) under the strip.
2. **Content-level chart assertions.** The dining tab's three charts and the
   services/housekeeping bar charts have no test asserting rendered content
   — a wrong `xKey`/series key renders an empty chart and every suite stays
   green, including on the revenue tab. Add one series-content assertion per
   chart-consuming content component (the guests/totals tests' converted
   async `findBy*` pattern is the template).
