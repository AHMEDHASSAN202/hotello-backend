# Epic 26 — Staff Task PWA

> **Scope:** The fourth frontend (`gxp-staff-frontend`) — one mobile-first PWA for **all on-ground workers**: housekeeping attendants, kitchen/runners, maintenance — closing the loop the dashboards can't (a cleaner doesn't run mornings from a desktop). Same tenant credentials (username workers from 9.7 included), permission-gated feed tabs (Requests / Orders / Rooms), the **two-lane task model** ("مهامي" + "متاح للاستلام"), big thumb-friendly actions, and **staff push notifications** (the piece explicitly deferred from Epic 23 — subscriptions bound to `tenant_users`, not stays).
>
> **Prime directive inherited from Epic 14:** app, not website — this one lives in a worker's pocket through 8-hour shifts on mid-range Androids. Speed and glanceability outrank information density.
>
> **Backend reality:** ~95% exists. Every action endpoint (requests/orders lifecycle, housekeeping transitions) was deliberately built PWA-consumable (Epics 15/16/20 notes). New backend work is small and listed exhaustively in note 1.
>
> **Languages:** AR + EN only (staff-facing rule, like the dashboards). RTL-first — most workers will use Arabic.
>
> Standing conventions live in the CLAUDE.md files; this repo gets its own CLAUDE.md as part of the epic (note 9).
>
> **Tenant permission catalog additions:** none. The PWA is a *surface* over existing permissions — `requests.update`, `fnb_orders.update`, `housekeeping.update` decide the tabs. That's the whole authorization model.

---

## Story 26.1 — App Foundation, Login & Routing

**As a** worker,
**I want** to open one link, log in once, and land on my work,
**so that** the app disappears and the shift remains.

### Acceptance Criteria

- **AC1 — Project:** `gxp-staff-frontend`, Next.js PWA, tenant-resolved like the dashboard (subdomain + `/t/{slug}` fallback; suspended-hotel lock screen; read-only mode honored — expired-trial hotels: workers see tasks but mutating actions explain the state). Manifest/SW/offline-fallback per the Epic 14 machinery; performance budget: LCP < 2.5s on mid-range Android (CI-asserted).
- **AC2 — Login:** the tenant login flow verbatim (email-or-username + password, `must_change_password` interstitial, lockout behavior) against the existing tenant auth — **zero new auth endpoints**. Session persists across restarts.
- **AC3 — Tab derivation:** after login, feed tabs render from held permissions: `requests.update` → Requests · `fnb_orders.update` → Orders · `housekeeping.update` → Rooms. One tab = no tab bar (straight into it). Zero relevant permissions → a friendly "this account has no field tasks" screen with a dashboard link.
- **AC4 — The redirect law (both directions):** a user whose role holds **no dashboard-level permissions** logging into the **dashboard** gets auto-redirected here (with a one-line explainer); the PWA offers a quiet "Open dashboard" link only to users who *do* hold dashboard permissions (supervisors using both). Implemented as one shared "primary surface" resolver — record its rule.
- **AC5 — App shell:** hotel name/logo header (worker's hotel context), the worker's name, language switch (AR ⇄ EN, persisted to `preferred_language`), sign out. Design tokens: its own set — utilitarian-premium (the guest app's polish discipline, a tool's visual temperature); big type, high contrast (sunlight legibility), 48px+ targets.

---

## Story 26.2 — The Two-Lane Task Model

**As a** worker,
**I want** my work separated from grabbable work,
**so that** ownership is never ambiguous and nothing rots unclaimed.

### Acceptance Criteria

- **AC1 — Every feed tab is two lanes:** **"مهامي"** (assigned to me — my responsibility, sorted by SLA urgency then age) above **"متاح للاستلام"** (unassigned — first-come). Tasks assigned to *someone else* **do not appear at all** (the supervisor's full view stays in the dashboard — stated in guidance).
- **AC2 — Claim semantics:** tapping Start on an unassigned task claims it (the existing auto-assign-on-start behavior) — it moves to my lane instantly and vanishes from colleagues' available lanes on their next delta (seconds). A lost race (someone claimed it first) shows a friendly "استلمها زميلك" and the item slides out — never an error tone.
- **AC3 — Backend addition:** the requests/orders/housekeeping list endpoints gain an `assignee=me|unassigned` filter (the one flagged backend change) — server-side, tenant-isolated, tested. The PWA never client-filters assignment.
- **AC4 — Counts:** tab badges show my-lane counts; the available lane shows its count inline. Empty lanes get designed states ("مفيش مهام عليك دلوقتي ✨" / "مفيش حاجة متاحة").

---

## Story 26.3 — The Feeds (Requests · Orders · Rooms)

**As a** worker,
**I want** each task readable in one glance and closable in one thumb,
**so that** the phone never slows the trolley.

### Acceptance Criteria

- **AC1 — Requests tab:** card = item name (staff language), room, age vs SLA (amber/red), note (with language tag, as the dashboard), option value. Actions: **Start** / **Done** — full-width buttons, one tap, optimistic with reconcile. Detail sheet on tap for the timeline.
- **AC2 — Orders tab:** card = line summary ("2× موهيتو + 1× أم علي"), **destination prominent** ("البسين — شمسية 12" / room), payment chip ("كاش: 560 ج.م" / "على الغرفة" / "✓ مشمول") — the runner must know what to collect. Actions follow the F&B lifecycle: **Start (preparing) → Out for delivery → Delivered**; roles that only deliver still see the full chain state.
- **AC3 — Rooms tab:** my assigned rooms grouped by floor + the unassigned lane; card = room number (big), cleaning-type chip (checkout clean sorted first), DND state (Start blocked with the explanation). Actions: **Start / Done / توقفت** (interrupted, keeps reason). `last_cleaned` visible in the detail sheet.
- **AC4 — Liveness:** the delta pollers (established pattern — reuse the hooks' architecture, new consumer) keep lanes current (~10s, boosted on-screen); transitions animate; pull-to-refresh everywhere.
- **AC5 — Cancel/complete elsewhere:** a task cancelled or completed from the dashboard slides out of the lane with a one-line toast ("اتلغى الطلب من الإدارة") — never a dead button press.

---

## Story 26.4 — Staff Push Notifications (the Epic 23 deferral, closed)

**As a** worker,
**I want** my pocket to buzz for MY work,
**so that** standing at the linen closet doesn't mean missing an assignment.

### Acceptance Criteria

- **AC1 — Subscription model:** push subscriptions bind to the **`tenant_user`** (device table keyed by user, not stay) — active while the account is; sign-out unsubscribes the device; `disabled` accounts are silenced by the same validity-gate pattern (user-active check before send, mirroring stay-validity).
- **AC2 — Triggers (v1, deliberately few):** ① a task is **assigned to me** (by a supervisor) — always pushes ("اتعيّنتلك غرفة 304 🧹"); ② a **new unassigned task** lands in a lane I hold the permission for — pushed with a per-user toggle (default ON; busy hotels may drown — the toggle is the guidance). Status-progress pushes (guest-style) are *not* sent to staff — the board is the tracker.
- **AC3 — Infrastructure reuse:** two new entries in the Epic 23 `PushType` registry + emission lines at the existing assignment/creation points; dispatch outbox, retries, TTLs, collapse (per-lane), quiet-hours **not applied** (shifts are the quiet-hours) — all ride the existing pipeline. No parallel push system.
- **AC4 — Permission UX:** the contextual pre-prompt pattern (Epic 23) adapted: prompted after first claim ("نبلغك لما توصلك مهمة؟"); iOS A2HS guide reused **including the ios-install state fix**; settings row in the shell.
- **AC5 — Deep links:** pushes open the app on the exact tab + lane, task highlighted.

---

## Story 26.5 — Shift Glance (Home Strip)

**As a** worker,
**I want** the top of the app to summarize my moment,
**so that** "أنا واقف فين النهاردة؟" needs zero taps.

### Acceptance Criteria

- **AC1 — Strip:** above the tabs: my open-task count, my done-today count, and the most urgent item (worst SLA in my lane) as a tappable chip. Nothing else — this is a glance, not a report.
- **AC2 — Done-today** resets on the hotel-local day (Intl helpers); counts come from the existing endpoints (no new aggregates — note 1 defines the tiny counts addition if the list endpoints can't cheaply provide it).

---

## Implementation Notes for Claude Code

1. **Exhaustive new-backend list (everything else is consumption):** ① `assignee=me|unassigned` filter on the three list endpoints (26.2 AC3); ② staff push subscription storage + the two registry types + emission lines (26.4); ③ the primary-surface resolver flag (26.1 AC4) if not derivable client-side from the permission payload (prefer deriving — record the choice); ④ done-today count if not cheap from existing lists. Nothing else — any other backend change is scope creep and needs a recorded ruling.
2. **Reuse inventory (copy the architecture, import nothing cross-repo):** delta-poller hook pattern, bottom-sheet, Switch, skeletons, i18n setup (AR/EN, parity check), the tenant login flow logic, Epic 23's SW push handler + pre-prompt/A2HS flows (guest repo is the reference implementation — port, don't share a package unless one already exists).
3. **Optimistic actions with truth reconcile:** Start/Done apply instantly, reconcile on the next delta; a rejected optimistic action (claimed race, cancelled task) rolls back with the friendly treatments (26.2 AC2 / 26.3 AC5) — never a stuck spinner.
4. **RTL-first review:** build and review screens in Arabic *first*, English second — inverse of the usual habit; the device design pass (14.5 AC6 standard) runs Arabic primary.
5. **Read-only mode:** expired-trial hotels — lanes visible, actions disabled with the standard translated explanation (the guard already returns the code).
6. **One transition source:** all actions call the existing services' endpoints; the PWA introduces **zero** new state logic — if a needed transition seems missing, that's a spec conversation, not a workaround.
7. **Performance:** workers keep the app open for hours — memory-stable polling (no unbounded arrays), visibility-aware poll backoff (screen off → slow), tiny bundle (no charts, no heavy deps; target well under the guest budget).
8. **Tests:** tab derivation matrix (permission combos), two-lane filter correctness against the new backend filter, claim race UX, optimistic rollback, push registry entries + user-validity gate + toggle, redirect law both directions, AR/EN parity, RTL snapshots for the three card types. Real-device checklist: claim/complete flow on Android, staff push on Android + installed iOS, sunlight-legibility judgment call.
9. **CLAUDE.md for this repo:** author it — prime directive (pocket tool, glanceability), AR/EN + RTL-first rule, two-lane law, zero-new-state-logic rule, reuse-by-porting rule, performance/battery rules, specs cross-reference.

---

## Notes & Dependencies

- **Depends on:** Epics 8–10 (tenant auth/permissions), 15/16/20 (the feeds + endpoints), 23 (push infrastructure + iOS fix).
- **Feeds:** Epic 24 Laundry (its ops lifecycle becomes a fourth tab candidate — the tab system must make that a config addition), future attendance/shift features, the pilot's operational story ("your staff need one link, not training").
- **Deferred:** supervisor views in the PWA (dashboard remains their home), shift scheduling/attendance, task photos/proof-of-work, inter-worker handoff, offline action queueing (v1 requires connectivity; hotel WiFi assumed), Laundry tab (arrives with Epic 24).

---

## Recorded decisions (planning, 2026-09-05)

1. **Lane filter shape.** Query param `assignee` ∈ `me` | `unassigned` | `me,unassigned` on `GET /tenant/requests`, `GET /tenant/fnb-orders`, `GET /tenant/housekeeping/board`. Every returned row gains `lane: 'mine' | 'available'`. In delta mode, a changed row that is not in a requested lane returns as `{ id, active: false, reason }` with `reason` ∈ `taken` (now someone else's) | `closed` (done/delivered/clean) | `cancelled` | `removed` (room inactive / parked DND etc.). Lane rules: **mine** = assigned to me AND open; **available** = unassigned AND open (rooms: unassigned AND `needs_cleaning`; a DND room assigned to me stays in mine so the DND explanation can render). The PWA requests `me,unassigned` once per feed per tick — one poll, server-split lanes. The filter is ignored on `tab=history`.
2. **Claim race = the existing 409.** No server-side "already claimed" rejection is added (a supervisor starting a colleague's assigned task from the dashboard is intended behavior — Epics 15/16/20 tests `'start keeps an existing assignee'`). The PWA treats a `*_INVALID_STATUS` 409 on Start whose body `status` is `in_progress`/`preparing` as "استلمها زميلك"; a 409 with `status: 'cancelled'` as "اتلغى من الإدارة"; a 409 with a final status as "اتقفل من الإدارة". The ≤10 s window in which a task assigned-but-not-started to colleague A is still visible to B is accepted (B's Start succeeds and A stays assignee, matching the dashboard).
3. **Primary surface is a backend flag** (`user.primarySurface: 'dashboard' | 'staff'` on the login response and `/tenant/me`), computed by one pure function `resolvePrimarySurface(permissions)` in `tenant-permissions.constants.ts`. Rule: `*` → dashboard; no field-action key (`requests.update`, `fnb_orders.update`, `housekeeping.update`) → dashboard; any key outside `FIELD_SURFACE_PERMISSIONS` (`requests.read`, `requests.update`, `fnb_orders.read`, `fnb_orders.update`, `housekeeping.read`, `housekeeping.update`, `rooms.read`) → dashboard; else staff. Chosen over client-side derivation because two frontends would otherwise duplicate the key set (Laundry later = one edit, not three). Note: the seeded Housekeeping role holds `rooms.update`, so it resolves to `dashboard`; hotels create a leaner attendant role or trim it (recorded, not changed here — changing seeded roles is out of the exhaustive list).
4. **Session handoff = re-login on the PWA origin.** Sessions are per-origin by design (hotel FE `lib/auth.ts` comment) and a token handoff would be a new auth endpoint. The dashboard's redirect law therefore never stores a staff-surface session: on login it explains in one line and sends the user to `{STAFF_APP}/t/{slug}/login?identifier=…` (identifier prefilled, not the password). Direct-URL entries hit the same screen from `TenantProvider`. The PWA session then persists across restarts (26.1 AC2).
5. **Staff push storage = the same two tables.** `push_subscriptions.stayId` and `push_dispatches.stayId` become nullable; both gain `tenantUserId uuid NULL` with a CHECK that exactly one owner column is set. A device endpoint is unique, so a shared phone re-binds between guest and staff use. `attemptSend` gates staff rows on `tenant_user.status === 'active'` AND hotel active (`USER_INACTIVE`, terminal), mirroring `STAY_INACTIVE`.
6. **Per-user "new available task" toggle = hint key** `staffPush.availableMuted` (dismiss = muted, un-dismiss = on; default on) — the established per-user boolean idiom (`requests.soundMuted`). No migration.
7. **Registry topics take `(refId, vars)`** so staff types collapse per lane (`sa-requests`, `sv-rooms`, …) rather than per task. `uuidTopic` becomes null-safe. Existing entries unaffected.
8. **Emission points:** `staff_assigned` at requests/orders/rooms `assign` (+ housekeeping `bulkAssign`, one push with a count) when the assignee is not the actor. `staff_available` at guest request submit, guest order create, housekeeping vacate + manual flag (actor excluded) and once per hotel per daily tick with the flagged count. Recipients = active users in the hotel holding the lane's `.update` key (or `*`), minus muted, minus the actor; only users who subscribed from the PWA have devices, so owners/dashboard users are not spammed.
9. **Deep links:** `?open=requests:<id>` | `orders:<id>` | `rooms:<id>` | `requests` | `orders` | `rooms` (bare = open the tab). The PWA highlights the task in whichever lane it sits.
10. **Done-today** is per user: requests `completedById = me`, orders `deliveredById = me`, rooms `housekeeping_events(eventType='completed', actorId=me)` — hotel-local day via `startOfHotelDay`. Returned as `counts.myDoneToday` only when `assignee` is present (the dashboard's payload is untouched).
11. **Staff welcome/reset emails keep pointing at the dashboard** (`buildLoginLink`); the redirect law forwards field workers from there. No `STAFF_APP_BASE_URL` on the backend in v1 (push URLs are relative).
12. **Interrupt reasons are audit-only today** (not in any view). The PWA collects the reason (required, ≤500) and sends it; it does not display past reasons. Showing them would be new backend work — deferred, recorded.
