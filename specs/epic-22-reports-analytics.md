# Epic 22 — Reports & Analytics

> **Scope:** Turning 21 epics of accumulated data into decisions. An **Overview dashboard** (the screen an owner opens every morning), per-module reports (**Guests & Stays · Services/Requests · Housekeeping · Dining · Events**), the **Outstanding Balances** view (rooms/stays carrying unsettled charges — the explicitly requested one), a consolidated **Totals** report, and CSV/Excel exports.
>
> **Second consumer of the upsell shell:** this module is plan-gated (`analytics`). Hotels without it get the `ModuleUpsell` locked page built in Epic 18 — with a **sample-data preview** so they see exactly what they'd unlock.
>
> **Design principle — answers, not dashboards:** every widget answers a question a hotel manager actually asks ("how many rooms did we clean today?", "is anyone leaving without paying?"). No vanity charts, no metrics nobody acts on.
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `reports.read`, `reports.export`
> Seeded roles: Manager gets both; Front Desk gets `reports.read` **scoped to the operational reports only** (stays, requests, housekeeping, balances — not revenue). Owner `*` as always. Module key: `analytics`.

---

## Story 22.1 — Overview Dashboard

**As a** hotel owner or manager,
**I want** one screen that tells me how the hotel is doing right now,
**so that** my morning check-in takes 30 seconds.

### Acceptance Criteria

- **AC1 — Period selector:** Today · Yesterday · Last 7 days · Last 30 days · custom range (hotel-local day boundaries via the Intl helpers). The selection persists per user for the session.
- **AC2 — Top row (occupancy & guests):** current occupancy (occupied/total active rooms + %), arrivals today, departures today, in-house guests, stay-type breakdown (mini bar: All-Inclusive / Half Board / B&B / Room Only).
- **AC3 — Service health:** requests received / completed / **open now**, average completion time, **SLA breach rate** (the one operational number that predicts bad reviews), and the top 5 requested items in the period.
- **AC4 — Revenue strip (permission-gated to revenue holders):** dining revenue, events revenue, **total revenue**, split cash vs room-charge, and **unsettled balance total** (links to 22.4).
- **AC5 — Housekeeping pulse:** rooms cleaned today, currently needing cleaning, in progress, DND count.
- **AC6 — Comparisons, honestly:** each headline shows a delta vs the previous equivalent period ("+12% vs last week") only when the previous period has enough data; otherwise it renders nothing rather than a misleading arrow.

---

## Story 22.2 — Operational Reports (Guests · Services · Housekeeping)

**As a** manager,
**I want** detail behind each operational number,
**so that** I can find the cause, not just the symptom.

### Acceptance Criteria

- **AC1 — Guests & Stays:** stays in period (arrivals, departures, in-house), average length of stay, occupancy trend line by day, stay-type distribution, guest-language distribution (**directly actionable: staffing and menu translation priorities**), room-change count.
- **AC2 — Services (Requests):** volume by day, breakdown by category and by item, completion-time distribution, **SLA compliance per category** (which department is slow), cancellations with reasons, busiest hours heat strip (staffing insight).
- **AC3 — Housekeeping:** rooms cleaned per day split checkout/daily, average time from flag to clean, per-attendant completion counts (**framed as workload distribution, not a leaderboard** — guidance says so explicitly), DND frequency, rooms cleaned per attendant per day.
- **AC4 — Drill-through:** any row/segment links to the underlying filtered list in its own module (a category bar → the requests history filtered to it) — reports lead back to the work, not to a dead end.

---

## Story 22.3 — Revenue Reports (Dining · Events)

**As an** owner,
**I want** to see what the platform is actually earning me,
**so that** the subscription justifies itself in one glance.

### Acceptance Criteria

- **AC1 — Dining:** revenue by day, orders count, average order value, **top-selling items** (qty + revenue), revenue by destination zone (room vs pool vs beach — proves the location feature's worth), cash vs room-charge split, cancellations. **Included-item volume shown separately as consumption, never as revenue** (All-Inclusive honesty — a ✓Included mojito is a cost, not a sale).
- **AC2 — Events:** per event — booked / capacity / attendance-basis revenue, free vs paid vs included breakdown, cancellation rate, best-performing events.
- **AC3 — Combined revenue:** the **Totals report** — dining + events, by day and by payment method, with the period's grand total and the collected vs outstanding split. This is the number the owner screenshots.
- **AC4 — Currency & honesty:** hotel currency throughout; every revenue figure states its basis in a footnote-style line ("delivered orders only", "excludes cancelled") — no ambiguous numbers.

---

## Story 22.4 — Outstanding Balances (Rooms & Stays With Money Due)

**As a** front desk user,
**I want** to see exactly which rooms owe money,
**so that** nobody checks out unpaid.

### Acceptance Criteria

- **AC1 — The view:** a list of **active stays with unsettled room charges**: room number, guest name, checkout date, unsettled total, breakdown (dining / events), oldest unsettled item age. Sorted by **checkout date ascending** — today's departures at the top, because that's the urgency.
- **AC2 — Departure alert:** stays checking out **today** with a balance are visually flagged (amber) and counted in a header stat ("3 غرف مغادرة اليوم عليها مستحقات").
- **AC3 — Settle from here:** the bulk-settle action from Epic 16.8 is available inline (permission `stays.checkout`), so the desk can clear balances without hopping modules.
- **AC4 — Rooms list integration:** the Epic 11 rooms list and the Epic 13 stays list gain an optional "has balance" column/badge with a filter — the requested "know which rooms owe money from the rooms/stays list" — driven by the same computation as this report (one source of truth).
- **AC5 — Historical leakage:** a secondary tab lists **checked-out stays that left unsettled** (the auto-checkout case from 16.8 AC2) — the hotel's actual loss ledger, with totals per period.

---

## Story 22.5 — Exports

**As a** manager with `reports.export`,
**I want** to take numbers out of the system,
**so that** accounting and ownership meetings are painless.

### Acceptance Criteria

- **AC1 — Export scope:** every report exports its current view (respecting period + filters) as **.xlsx** — reusing the Epic 11 export machinery (styled header, frozen row, auto-filter), and CSV where a raw feed is more useful (transaction-level lists).
- **AC2 — Transaction-level exports:** orders, bookings, requests, and stays export as row-per-record with all key fields (dates in hotel timezone, amounts unformatted-numeric for spreadsheet math).
- **AC3 — Filename & metadata:** `{hotel-slug}-{report}-{from}-{to}.xlsx`, with a header sheet/row stating hotel, period, generated-at, and the basis line from 22.3 AC4.
- **AC4 — Audit:** `report.exported` (report type + period + actor) — exports contain guest names, so they're tracked.

---

## Story 22.6 — Upsell State & Access Discipline

**As the** platform,
**I want** analytics to be a clean upsell,
**so that** it sells itself without dark patterns.

### Acceptance Criteria

- **AC1 — Locked state:** hotels without `analytics` see the `ModuleUpsell` shell (Epic 18) rendering the **Overview with realistic sample data**, visibly labeled "بيانات توضيحية" so nobody mistakes it for their own, controls disabled, one honest upgrade line.
- **AC2 — Revenue scoping:** `reports.read` without revenue rights (Front Desk seeded role) hides revenue widgets/reports entirely — server-side, not CSS. Tested explicitly.
- **AC3 — Guest privacy:** reports aggregate; guest names appear only in the operational lists where the desk already sees them (balances, stays) and in exports — never in analytics widgets.

---

## Implementation Notes for Claude Code

1. **Query strategy first:** these are read-heavy aggregations over existing tables (`stays`, `requests`, `fnb_orders`, `event_bookings`, `rooms`, audit-free). Write them as **dedicated repository query methods with explicit indexes added by migration** (date + hotel_id composites at minimum) — measure on seeded volume (simulate ~50 rooms × 90 days) and record timings in the report. No materialized views/rollup tables in MVP; revisit only if a query exceeds a budget (~500ms).
2. **One computation source per number:** the unsettled-balance calculation already exists from 16.8 — reports, the rooms/stays badges (22.4 AC4), and the checkout interlock must all call the same service method. Same for occupancy (Epic 13's data) and SLA math (Epic 15's). **Never re-implement a metric.**
3. **Period handling:** hotel-local day boundaries via the established Intl helpers; comparisons compute the previous equivalent window; guard against partial-period distortion (22.1 AC6).
4. **Permission scoping:** implement revenue-visibility as a distinct check (a `reports.revenue` capability derived from role permissions or an explicit permission — choose and record) enforced in the service layer; the Front Desk case is the test.
5. **Frontend:** a Reports section with the overview + report tabs; charts via a light library already acceptable to the bundle (dashboard app, not the guest PWA — budget is looser but still be sane). Tables reuse the established list components; drill-through links carry filters via query params.
6. **Exports:** reuse the Epic 11 xlsx service; stream, never persist; large exports capped (e.g., 10k rows) with a clear message.
7. **Sample data for the upsell:** a static fixture module (clearly named) — never seeded into the DB.
8. **Tests:** metric correctness against fixtures (each number computed two ways in tests where feasible), period boundary cases (hotel-local midnight, DST), revenue-scoping enforcement, balance parity across the three surfaces (report/list badge/checkout), export shape + filters respected, upsell vs permission distinction, query performance smoke. AR/EN parity. Builds clean.

---

## Decisions

- **Revenue scoping (implements note 4):** an explicit third permission key,
  `reports.revenue`, distinct from `reports.read`. Manager holds all three
  reports keys; Front Desk holds `reports.read` only. Never a route-level
  guard decorator — enforced in application code close to each endpoint, so
  the check can fit each response's shape: `ReportsOverviewService` does it
  service-side (an explicit `includeRevenue` parameter) because the Overview
  dashboard needs a partial payload — everything except the `revenue` key —
  for non-revenue holders, rather than 403ing the whole endpoint; the
  single-purpose revenue reports (`dining`/`events`/`totals`, whose entire
  response IS revenue data) gate at the controller instead, via a small
  `assertRevenueAccess` helper that 403s with `REPORTS_REVENUE_FORBIDDEN`
  before the service is ever called — simpler for an all-or-nothing response
  and keeps `ReportsRevenueService` itself permission-agnostic.
- **No plans backfill for `analytics`** (diverges from every prior module
  epic, which backfilled `enabledModules` on existing plans). `analytics` is
  the paid upsell — Super Admin enables it per plan through the existing
  plans UI, and hotels without it see the `ModuleUpsell` sample-data preview.
- **Housekeeping history and room-change counts are sourced from dedicated
  events tables** (`housekeeping_events`, `stay_room_changes`), written
  alongside (not replacing) the existing `audit_logs` compliance trail —
  jsonb mining was rejected as the wrong long-term source for a first-class,
  daily-use recurring report surface. Both tables start empty (pre-production,
  no backfill) and fill from the deploy date forward. **Recorded precedent for
  future epics:** dedicated events tables for recurring analytics,
  `audit_logs` for compliance only.

## Notes & Dependencies

- **Depends on:** all operational epics (11–21) for data; Epic 18's `ModuleUpsell` shell; Epic 11's export machinery.
- **Feeds:** the sales conversation (this is the "what am I getting?" screen), future PMS/accounting integrations, and the pilot's success measurement — **the first hotel's real numbers come from here**.
- **Deferred:** scheduled email reports, custom report builder, multi-property comparisons, forecasting, guest satisfaction metrics (needs a feedback module first), staff performance reviews as a formal feature.
