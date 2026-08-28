# Epic 20 — Housekeeping Operations

> **Scope:** The housekeeping operations board. Every room carries a **cleanliness status** on its own axis (separate from the room's operational status); rooms flag themselves automatically — **checkout clean** when a stay ends, **daily service** each morning for occupied rooms; supervisors assign attendants by room or whole floor; attendants work the queue from the dashboard (the Staff Task PWA takes over this exact backbone later); guests get a **Do-Not-Disturb toggle** in the app that the board respects.
>
> **Relationship to Epic 15:** guest-initiated cleaning *requests* (from the catalog) stay in the requests system — this epic is the hotel-initiated *routine* operation. The two are complementary; auto-linking a cleaning request to the board is a recorded deferred integration, not MVP.
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `housekeeping.read`, `housekeeping.update`, `housekeeping.assign`
> Seeded roles: Manager gets all three; **Housekeeping** gets read/update; Front Desk gets read (to answer "is my room ready?"). Module key: `housekeeping` (in the catalog since Epic 04) gates board, routes, and the guest DND toggle.

---

## Story 20.1 — Cleanliness Model & Auto-Flagging

**As the** platform,
**I want** rooms to know their own cleaning state without anyone typing,
**so that** the morning board is already correct when the team clocks in.

### Acceptance Criteria

- **AC1 — The axis:** `housekeeping_status` per room: `clean` · `needs_cleaning` · `in_progress` · `dnd`. Fully independent from `rooms.status` (an `out_of_service` room keeps whatever cleanliness state it has; `inactive` rooms don't appear on the board). New rooms start `clean`.
- **AC2 — Cleaning type:** a `needs_cleaning` flag carries its reason: **`checkout`** (deeper turnover clean) or **`daily`** (stay-over service) — visually distinct on the board, checkout cleans sorted first within a floor.
- **AC3 — Checkout trigger:** any checkout (manual or automatic, Epic 13) sets the room `needs_cleaning (checkout)` — including room-changes (the vacated room flags).
- **AC4 — Daily trigger:** at the hotel's **daily service hour** (setting, default 09:00 hotel-local, in the housekeeping settings card) the job flags occupied rooms `needs_cleaning (daily)` — skipping rooms currently `dnd`, already flagged, or `in_progress`. Idempotent, hotel-local via the Intl helpers, riding the existing job cadence.
- **AC5 — Manual override:** staff with `housekeeping.update` can flag/unflag any room manually (guidance explains the auto rules so manual use stays exceptional). Audit `housekeeping.flagged/cleared` with reason.

---

## Story 20.2 — The Board

**As a** housekeeping supervisor with `housekeeping.read`,
**I want** the whole hotel's cleaning state on one screen,
**so that** I run mornings from a board, not a clipboard.

### Acceptance Criteria

- **AC1 — Layout:** rooms grouped by floor in natural order, each a compact status card: room number, status color, cleaning-type chip, occupancy dot (occupied/vacant via the Epic 13 data), assignee avatar/initials, DND mark. Delta-polled live (the established poller pattern), status changes animate.
- **AC2 — Header stats:** today at a glance — to clean (checkout / daily split) · in progress · done today · DND. The "done today" counter is the supervisor's progress bar for the shift.
- **AC3 — Filters:** floor, status, cleaning type, assignee, "unassigned only". Front-desk quick answer: search a room number → its card highlights.
- **AC4 — Guidance DoD:** status chips + auto-rule InfoTips; empty board ("كل الغرف نظيفة ✨") designed state.

---

## Story 20.3 — Assignment & Work Lifecycle

**As an** attendant or supervisor,
**I want** clear ownership and two-tap progress,
**so that** no room is cleaned twice and none is forgotten.

### Acceptance Criteria

- **AC1 — Assignment (`housekeeping.assign`):** assign a room — or **bulk-assign a floor / selection** — to any staff member holding `housekeeping.update` (options-endpoint pattern). Reassignment allowed; assignee shows on the card; "my rooms" filter for attendants.
- **AC2 — Lifecycle (`housekeeping.update`):** `needs_cleaning → in_progress` (Start — auto-assigns self if unassigned, same convention as requests) `→ clean` (Done). A DND room can't be started (the action explains why). `in_progress → needs_cleaning` (Stopped/interrupted) allowed with the reason kept.
- **AC3 — Room memory:** each room stores `last_cleaned_at/by` — shown on the card tooltip and the room detail (Epic 11 page gains the line). Full per-room cleaning history is deferred; the audit trail already captures events.
- **AC4 — Audit:** `housekeeping.assigned/started/completed/interrupted`.

---

## Story 20.4 — Guest Do-Not-Disturb

**As a** guest,
**I want** one switch that keeps housekeeping away today,
**so that** nobody knocks during my nap — without a door hanger.

### Acceptance Criteria

- **AC1 — Toggle:** a DND switch on the guest home's stay card (module-gated by `housekeeping`): "عدم الإزعاج اليوم" with a short explainer. Instant apply; localized ×7.
- **AC2 — Effect:** room shows `dnd` on the board; the daily flag skips it (20.1 AC4); staff see the DND mark and the Start action is blocked with the explanation. An already-`needs_cleaning` room going DND keeps its flag but is visually parked under DND until released.
- **AC3 — Reset:** DND auto-clears at the **next daily service hour** (a nap shouldn't cancel tomorrow's clean) — stated in the guest explainer ("سيُعاد التنظيف غدًا تلقائيًا"). The guest can toggle off anytime; checkout clears it with the stay.
- **AC4 — Not a request channel:** the toggle is not "clean now" — the existing catalog request covers that; guidance cross-links it ("تحتاج تنظيفًا الآن؟ اطلبه من الخدمات").

---

## Implementation Notes for Claude Code

1. **Schema:** columns on `rooms` (`housekeeping_status`, `cleaning_type?`, `dnd_set_by_stay_id?`, `last_cleaned_at/by`) rather than a new table — current-state-only is the model; history lives in audit. `daily_service_time` beside `checkout_time` on hotels. Migration + role/plan backfills in-PR as usual.
2. **One transition function:** `(room, action, actor) → newState | error` covering the full matrix incl. DND blocks and interrupted-reason — used by board actions, the guest toggle, checkout hook, and the daily job. Test the matrix exhaustively.
3. **Checkout hook:** subscribe to the existing checkout path(s) (manual + auto + room-change vacate) in the stays service — don't duplicate checkout logic; one emission point per vacate.
4. **Daily job:** extend the established hourly/5-min job runner with the hotel-local daily-hour comparison (Intl helpers); DND auto-clear rides the same tick. Idempotency keys per room per day.
5. **Board frontend:** this is a **room-grid board, not a card-feed** — reuse the delta poller + sound/badge infrastructure but build the grid layout fresh (don't force the requests board core to fit; record the choice). Floor grouping reuses natural sort.
6. **Guest toggle:** rides the existing guest profile/stay envelope (`dndActive`) + one `POST /guest/dnd` — no new poller; the stay card already re-renders on the shared poll.
7. **Permission interplay:** attendants (Housekeeping role) act via dashboard today; keep every action endpoint-shaped so the Staff Task PWA consumes them unchanged later (this board is that PWA's future feed — say so in code comments sparingly).
8. **Tests:** transition matrix, checkout/room-change vacate flags, daily-job skip rules + idempotency + DND auto-clear timing, bulk assign, board delta correctness, guest toggle gating + reset, seven-locale + AR/EN parity, module gating everywhere. Device pass: the board on the front-desk tablet size. Builds clean.

---

## Recorded decisions (implementation, 2026-08-29)

1. **DND on an `in_progress` room** = interrupted-by-guest: `in_progress → dnd` keeps `cleaningType`, so release returns the room to `needs_cleaning`.
2. **Guest DND toggle is idempotent** both ways (double taps are 200s, no audit on no-change); staff actions are strict (409 `HOUSEKEEPING_INVALID_STATUS` / `HOUSEKEEPING_ROOM_DND`).
3. **DND ↔ daily-tick semantics:** `setDnd(on)` stamps the room's `lastDailyFlaggedOn` with the hotel-local date — the guest opted out of *today's* service, so the tick neither flags nor releases the room before tomorrow's service hour, even when DND was set before today's hour. At release, a room landing on `clean` while occupied is immediately daily-flagged (the promised "يُعاد التنظيف غدًا"); a parked flag is simply restored.
4. **Vacate hook** is a direct injected call (`HousekeepingService.onRoomVacated`), not EventEmitter2 (the events bus is notifications-only by convention). Three call sites: manual checkout, auto-checkout, room-change (old room, post-commit). It never throws into a checkout path. Vacate always lands `needs_cleaning (checkout)` from any state, incl. `in_progress`.
5. **Assignment storage:** `housekeepingAssignedToId` on `rooms`; cleared on `complete`, kept on `interrupt`. Bulk assign = `POST /tenant/housekeeping/assign-bulk { roomIds[], assigneeId }` (the FE resolves a floor to ids; foreign ids silently dropped by the hotelId filter) with **one** audit event carrying the id list.
6. **Settings:** `GET/PATCH /tenant/housekeeping/settings` `{ dailyServiceTime }`; PATCH gated `housekeeping.update` (stays-settings precedent); audits `hotel.updated` with a diff.
7. **Module posture:** default-on — the migration backfills `housekeeping` into every existing plan (announcements/hotel-info form, not the branding upsell form).
8. **Board deltas:** cursor = response `serverTime`; changed rows return regardless of status; rooms that turned `inactive` come back as tombstones `{ id, active: false }` (Epic 19 pattern). Hard-deleted rooms are not tombstoned — the mount-time full load covers that rare case.
9. **Daily job cadence:** `EVERY_5_MINUTES` (announcements precedent), house job shape (re-entrancy flag, injectable `now`). Idempotency = per-room `lastDailyFlaggedOn` vs the hotel-local date; no keys table.
10. **Guest surface:** the guest app has no shared profile poller (spec note 6 assumption), so the toggle applies optimistically, `POST /guest/dnd` echoes `{ dndActive }`, and state reconciles from `GET /guest/me` on boot/pull-to-refresh. `dndActive` rides `GuestProfile`.
11. **Rooms module surface:** room detail gains a `housekeeping` block (`housekeepingStatus`, `cleaningType`, `lastCleanedAt/By`) field-gated by `housekeeping.read` (the `currentStay` precedent); the rooms list table is untouched.
12. **DND audit actions:** `housekeeping.dnd_set` / `housekeeping.dnd_cleared` (actorType `guest` for the toggle, `system` for the auto-clear) — additions to the AC4 list of 20.3.

## Notes & Dependencies

- **Depends on:** Epics 11/13 (rooms, stays, checkout events, local-time helpers), 15/16 poller patterns, 12 guidance kit.
- **Feeds:** Staff Task PWA (this board is its primary feed), Reports (Epic 22: cleans/day, time-to-clean), the deferred request↔board integration.
- **Deferred:** per-room cleaning history UI, time-per-room metrics, linen/minibar checklists, inspection step (clean → inspected), request↔board auto-linking, printable morning sheets.
