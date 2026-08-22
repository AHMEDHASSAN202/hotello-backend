# Epic 15 — Guest Requests (End to End)

> **Scope:** The core loop of the product: a guest submits a request from the Guest App in their language; the hotel sees, works, and completes it in the Tenant Dashboard. Ships the **multilingual request catalog** (the language-barrier solution), guest submission + tracking, the tenant requests board with lifecycle + SLA, and activation of the Requests tile from Epic 14.
>
> **The language-barrier trick (core design):** requests are **structured catalog picks, not free text**. The catalog ships platform-translated in all 7 guest languages — the guest taps "Дополнительные полотенца", the staff reads "مناشف إضافية". Translation happens by data design, not by machine translation. Free-text notes are the only untranslated element in MVP (shown as-is with a language tag; MT is a flagged fast-follow).
>
> **Realtime honesty:** MVP uses polling (guest status + tenant board). WebSockets/push are deferred — the board polls fast enough to feel live. The future Staff Task PWA consumes this same requests backbone.
>
> Standing conventions live in the CLAUDE.md files (all four repos now).
>
> **Tenant permission catalog additions:** `requests.read`, `requests.update`, `requests.assign`, `request_catalog.manage`
> Seeded roles: Manager gets all four; Front Desk gets read/update/assign; Housekeeping gets read/update. Module key: `requests` in `enabled_modules` gates everything (tile, routes, board).

---

## Story 15.1 — Request Catalog (Platform-Translated, Hotel-Curated)

**As a** hotel user with `request_catalog.manage`,
**I want** a ready-made multilingual catalog I can curate,
**so that** guests get a professional request menu on day one with zero translation work from me.

### Acceptance Criteria

- **AC1 — Seeded catalog:** Platform ships categories + items **fully translated in all 7 guest languages** (+ AR/EN for staff display), each with an icon and a default SLA target (minutes). Starter set: **Housekeeping** (room cleaning, extra towels, bed linens change, pillows/blanket, toiletries), **Maintenance** (AC issue, plumbing issue, TV/electronics issue, light/electrical issue), **Amenities** (iron & board, baby cot, adapter, extra hangers), **Front Desk** (wake-up call [time option], luggage help, late checkout inquiry). Seed is idempotent + hooked into onboarding.
- **AC2 — Curation, not translation:** the hotel can enable/disable any category/item, reorder within categories, and adjust each item's SLA target. Platform items' translations are **read-only** for hotels (consistency guaranteed).
- **AC3 — Item options:** an item may define one simple option: quantity (min/max, e.g., towels 1–4) or a time picker (wake-up call). No free-form option builder in MVP.
- **AC4 — Custom items:** hotels can add custom items into existing categories: name/description in AR + EN required; the other 5 languages optional with per-field fallback to EN for guests. Clearly marked "custom" in management. SLA target required.
- **AC5 — Catalog versioning-lite:** disabling an item hides it from guests but never breaks existing requests (requests snapshot the item name at submission time).
- **AC6 — Audit:** `request_catalog.updated` events with diffs.

---

## Story 15.2 — Guest: Browse & Submit

**As a** guest,
**I want** to order what I need in three taps in my language,
**so that** asking feels easier than calling.

### Acceptance Criteria

- **AC1 — Tile activation:** the Requests tile from Epic 14 goes live (config flip + `requests` module check). Bottom-nav slot activates if this is the second section (per 14.5 AC3 architecture).
- **AC2 — Browse:** categories → items, all in the guest's language (their translation from the catalog; custom items fall back per 15.1 AC4). Icons, clean grid, app-feel per the Epic 14 design system (this screen inherits the prime directive).
- **AC3 — Submit flow:** tap item → bottom sheet with: quantity/time option if defined, optional note (free text, guest's language), submit. Optimistic confirmation animation → lands in "My requests" with status `new`. Three taps for a no-option item: tile → item → submit.
- **AC4 — Room binding:** the request binds to the stay's room automatically — the guest never types a room number (contract: identity = session).
- **AC5 — Sanity limits:** per-stay throttles (e.g., max 5 open requests, max 15/day — env-tunable) with a friendly limit message; duplicate-tap protection on submit.
- **AC6 — Empty/edge states:** module disabled mid-stay → tile returns to "soon" state gracefully; catalog empty (all disabled) → warm "contact the front desk" screen.

---

## Story 15.3 — Guest: Track & History

**As a** guest,
**I want** to see my requests move,
**so that** I trust it worked without calling to double-check.

### Acceptance Criteria

- **AC1 — My requests:** active list (status chips: Received / In progress / Done) + collapsed history for the stay. Statuses update via polling (interval env-tunable, ~15s active screen) — moving to `in_progress`/`done` animates subtly.
- **AC2 — Detail:** item name (guest language), option/note, submitted time (relative, localized), status timeline (received → started → completed with times).
- **AC3 — Cancel:** the guest can cancel while status = `new` only. Cancelled shows respectfully in history. After work started, the UI explains cancellation isn't available and suggests the front desk.
- **AC4 — Language:** everything in the guest's language incl. localized relative times ("5 мин назад") — the 7-locale parity check covers all new keys.

---

## Story 15.4 — Tenant: Requests Board

**As a** hotel user with `requests.read`,
**I want** a live board of incoming requests,
**so that** nothing sits unseen.

### Acceptance Criteria

- **AC1 — Board:** default view = open requests (new + in_progress), newest first with **overdue floated to top**; each card: item (staff language), room number, guest name, option/note (note shown as-is with a language tag, e.g., «RU»), age ("منذ 4 دقائق"), status, SLA state, assignee. Done/cancelled live in a history tab (filterable, paginated, permanent records).
- **AC2 — Filters:** status, category, floor, assignee, overdue-only. Category filter doubles as the department lens (Housekeeping staff filter to their categories — no hard routing wall in MVP: everyone with `requests.read` can see all).
- **AC3 — Liveness:** the board polls (~10s), new arrivals animate in + a badge count on the nav item updates app-wide; a subtle sound on new request (user-toggleable, default on for this page). No manual refresh needed.
- **AC4 — Guidance DoD:** status/SLA chips have InfoTips; empty board has the designed "all clear" state; the note language-tag has an InfoTip ("الملاحظة بلغة الضيف — الترجمة الآلية قادمة").

---

## Story 15.5 — Tenant: Lifecycle & Assignment

**As a** hotel user with `requests.update`,
**I want** clean state transitions with accountability,
**so that** every request has an owner and an outcome.

### Acceptance Criteria

- **AC1 — Transitions:** `new → in_progress` (Start — auto-assigns self if unassigned), `in_progress → done` (Complete), `new|in_progress → cancelled` (staff cancel requires a reason: guest request / not available / duplicate / other+note). `done`/`cancelled` are final. Guest cancellation (15.3 AC3) lands as `cancelled` with reason "guest".
- **AC2 — Assignment:** with `requests.assign`, assign/reassign to any staff member holding `requests.update` (options endpoint pattern like roles/options). Assignee shows on the card; "my requests" filter for staff.
- **AC3 — Timeline:** the request detail (drawer) shows the full timeline: submitted (with guest language + original note), started (by whom), completed/cancelled (by whom, reason) — timestamps in hotel timezone.
- **AC4 — Audit:** `request.started` / `request.completed` / `request.cancelled` / `request.assigned` with actors.

---

## Story 15.6 — SLA & Overdue

**As a** hotel manager,
**I want** time targets visible on every request,
**so that** slow service is caught while the guest is still smiling.

### Acceptance Criteria

- **AC1 — Timer:** each request carries its item's SLA target (snapshot at submission). Cards show elapsed vs target; at 80% the chip turns amber, past target it turns red + "متأخر" and the card floats to top (15.4 AC1).
- **AC2 — Scope:** SLA applies to reaching `done` from submission. Cancelled requests exit SLA. No penalties/escalation chains in MVP — visibility only (escalation notifications are a Staff-PWA-era feature).
- **AC3 — Baseline stats-lite:** the board header shows today's counts: open / done today / overdue now. (Full analytics module remains future.)

---

## Implementation Notes for Claude Code

1. **Entities:** `request_categories` + `request_items` (platform-seeded rows shared-definition but per-hotel enablement/order/SLA via a per-hotel settings table or per-hotel rows copied at onboarding — choose the simpler that keeps platform translation updates propagatable for non-custom items; document the choice in the spec) and `requests` (`id, hotel_id, stay_id, room_id, item snapshot {names, icon}, option_value?, note?, note_language, status, sla_target_minutes, assigned_to?, timestamps per transition, cancelled_reason?`). Requests are permanent records — the room/stay FKs must survive room renumber history rules already in place.
2. **Translations storage:** platform item translations as JSONB `{ar,en,ru,fr,it,es,de}` name/description — one row per item, not 7. Custom items same shape, missing keys fall back to `en` at read time (one fallback function, guest-side only).
3. **Guest endpoints (extend the `/api/guest` tree):** `GET catalog` (guest language resolved server-side, only enabled items, module-gated), `POST requests` (throttles from 15.2 AC5 enforced server-side), `GET requests` (own stay only — stay from JWT, never a param), `POST requests/:id/cancel` (own + `new` only). All behind `@GuestScope` + stay-validity.
4. **Polling economics:** both pollers use light endpoints (`updated_since` cursor returning deltas + counts) — don't re-ship full lists every 10s. Keep the interface shaped so a future WebSocket layer replaces the poller without touching components.
5. **Board UX:** follow the tenant design system; the card grid/list must stay readable on the front-desk tablet. The new-request sound: small, dignified, preloaded, respects the toggle (persisted per user like hint dismissals).
6. **Snapshotting:** item names snapshot into the request at submission (15.1 AC5) — catalog edits never rewrite history. SLA target snapshots too.
7. **Module gating everywhere:** `requests` module checked in guard order (established), tile flag (Epic 14 config), nav gating, and seeded-permission interplay (roles hold permissions dormant when module disabled — Epic 10 rule already covers this; verify with a test).
8. **Guest app screens** inherit Epic 14's design system + motion + i18n across all seven locales; the submit bottom sheet reuses the existing bottom-sheet component. The catalog + tracking screens get the same device design pass as 14.5 AC6.
9. **Tests:** throttle limits, guest-cancel window, transition matrix (incl. final states), assignment permission edges, snapshot immutability under catalog edits, fallback rendering for custom items in ru/de, delta-polling correctness, module-disabled behavior on both surfaces, overdue float ordering. Seven-locale parity + component tests both frontends. Builds clean.

---

## Notes & Dependencies

- **Depends on:** Epic 14 (app foundation, tile system), Epic 13 (stays — requests attach to them), Epics 10–12 machinery.
- **Blocks / feeds:** Staff Task PWA (consumes the same requests + assignment backbone), F&B epic (ordering follows this pattern with menus + delivery locations), analytics (request data accumulates now), machine-translation fast-follow (notes).
- **Deferred:** WebSockets/push, note machine translation, escalation notifications, guest photo attachments (useful for maintenance — revisit), scheduled requests ("clean at 2pm"), inter-department transfer flows.

---

## Decisions made during implementation

- **Catalog shape (note 1) — shared platform rows.** `request_categories` + `request_items` with `hotelId IS NULL` are platform-owned; per-hotel curation lives in `hotel_request_category_settings` / `hotel_request_item_settings` (row/column absence = platform default, so a new hotel needs **zero** rows and the onboarding hook is deliberately vacuous). `seedRequestCatalog` is platform-global, idempotent by key, runs from `npm run seed`, and **re-propagates edited platform fields** — that's the translation-fix path. Custom items are `request_items` rows with `hotelId` set (AR+EN mandatory, EN fallback via the single `localizeField`).
- **16 starter items** (5 housekeeping, 4 maintenance, 4 amenities, 3 front desk) in `default-request-catalog.ts`, all 7 languages + descriptions, lucide icon names (both frontends fall back to the concierge bell for unknown names).
- **Guest-side gating is service-level.** `TenantAccessGuard` no-ops on `@GuestScope` routes; `GuestRequestsService.assertRequestsAvailable` returns 403 `HOTEL_UNAVAILABLE` (suspended/read-only — matches the profile's `unavailable`) or `MODULE_NOT_ENABLED`. The tenant tree uses `@RequireModule('requests')` — the first real consumer; the catalog-group filter in `getCatalog()` is now covered by tests (note 7).
- **Throttles (15.2 AC5) are DB counts** (open per stay; created per hotel-local day via `startOfHotelDay`, added to the shared `stay-time.ts`), returned as 429 with distinct codes `REQUEST_LIMIT_OPEN` / `REQUEST_LIMIT_DAILY` so the guest app's login-lockout UI is not triggered. Duplicate-tap protection is client-side in-flight disable (server idempotency keys deferred with WebSockets).
- **Snapshots:** requests store `itemNames` (full map), `itemIcon`, `slaTargetMinutes`, `dueAt = createdAt + sla`, `roomId` + `roomNumber` (Stay.roomId is mutable via room moves). A request's room always had an active stay, so `hasStayHistory` already freezes renumbering — no extension needed.
- **Delta polling (note 4):** `updatedSince` on both trees returns rows with `updatedAt > since` (any status, so finished rows flow out of boards) + `serverTime` cursor + counts; clients merge by id. The tenant dashboard runs **one** app-wide poller (`RequestsFeedProvider`) shared by the nav badge and the board (the board boosts it to ~10s while mounted; badge idles at 45s).
- **Overdue/SLA chips are client-side** (`slaState`/`orderBoard` pure functions): amber at ≥80% elapsed, red + float past `dueAt` — flips live between polls; the server stores only `dueAt` and computes `counts.overdueNow`.
- **Cancel reasons:** guest cancel → `cancelledReason='guest'`, `cancelledById=NULL`; staff reasons `guest_request|not_available|duplicate|other` with a required note for `other` (DTO-level ValidateIf).
- **Sound toggle** rides the hint-key machinery: `requests.soundMuted` in `TENANT_HINT_KEYS` + new `DELETE /tenant/me/hints/:key` (un-dismiss) — hint keys now double as per-user toggles. The chime itself is WebAudio-synthesized (two tones, ~0.45s) — no asset.
- **`GET /tenant/request-catalog` is gated on `requests.read`** (not manage): the board's category filter needs names for every board user; all curation mutations stay behind `request_catalog.manage`. Platform item content edits are rejected with 403 `CUSTOM_ITEM_ONLY`.
- **`/tenant/me` now ships `hotel.timezone`** so the drawer timeline renders in hotel time (15.5 AC3).
- **Guest app:** the Requests section is a `GuestFlow` state (no new route — the JS budget check measures `/[slug]/page`; final bundle 117.4 kB of 130). The bottom nav component now exists (two slots, module-gated); the bottom-sheet drag was scoped to its grab area so sheet bodies can scroll and hold inputs. Audit adds `request.created` (actor null, `actorType:'guest'`) beyond the four staff events — every mutation audits, per repo law.
