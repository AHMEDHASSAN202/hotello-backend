# Epic 21 — Events & Workshops

> **Scope:** Hotels create events (yoga class, diving trip, seafood buffet night) with photos, capacity, and pricing (free / paid / included-for stay types); guests browse and book from a new **Events tile**, pay cash-at-event or on the room bill; publishing can auto-announce through the Epic 19 pipeline; the hotel sees attendee lists, and room-charged bookings join the Epic 16 checkout settlement.
>
> **This epic starts with two earned refactors (Story 21.1)** — their third/fourth consumers have arrived, so the extractions are now mandatory, not optional: the sharp rendition pipeline (4th consumer) and payment-methods config lifted from `fnb_settings` to hotel level (2nd consumer).
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `events.manage`, `events.read`
> Seeded roles: Manager gets both; Front Desk gets `events.read` (answering "is there space tonight?"). **Platform module catalog addition:** `events` (backfilled onto plans like `announcements` was). 

---

## Story 21.1 — Foundations (Earned Refactors)

**As the** platform,
**I want** the shared machinery extracted before its next consumers,
**so that** Events (and Laundry after it) copy architecture, not code.

### Acceptance Criteria

- **AC1 — Sharp pipeline extraction:** the three inline photo-rendition copies (F&B, Hotel Info, Branding) consolidate into one shared upload/rendition service (configurable rendition sizes + key prefix per consumer). The three existing consumers migrate to it with **zero behavior change** (existing keys/URLs untouched); Events becomes the fourth consumer through the shared path only.
- **AC2 — Payment config lift:** payment methods (`cash`, `room_charge`) move from `fnb_settings` to **hotel level** (migration carries existing values; F&B reads the new location; the settings card relocates to a hotel-level settings surface with a redirect/guidance from its old F&B spot). Events reads the same config. One setting, every paid module.
- **AC3 — Nothing else moves:** these are surgical extractions — no API shape changes for existing endpoints, all existing tests stay green before Events work begins (separate commits, refactor-first).

---

## Story 21.2 — Event Management

**As a** hotel user with `events.manage`,
**I want** to create and run events with capacity and smart pricing,
**so that** the weekly program sells itself from the app.

### Acceptance Criteria

- **AC1 — Fields:** title + description (AR + EN required, 5 optional w/ EN fallback), **photo** (via the shared pipeline — strongly encouraged, placeholder fallback), start datetime + optional end (hotel-local, future-only on publish), location (free text, e.g., "Beach — Building B" + optional Hotel Info entry link), **capacity** (positive int or unlimited), and **pricing:** free · priced (hotel currency) · priced with `included_for` stay types (same semantics family as F&B: listed types see ✓Included; empty list = paid for everyone).
- **AC2 — Lifecycle:** `draft → published → completed` (auto, once end/start passes) or `→ cancelled`. Drafts are fully editable; published events allow **safe edits only** (description, photo, capacity **increases**); time/price/capacity-decrease changes require cancel-and-recreate (guests booked under the old terms — guidance explains, mirroring the announcements edit rule).
- **AC3 — Cancel with care:** cancelling a published event requires a reason, auto-cancels all bookings, and **auto-sends a targeted announcement** (via the Epic 19 pipeline) to exactly the booked guests' stays ("للأسف تم إلغاء رحلة الغوص…"). ConsequenceNote states booking count before confirming.
- **AC4 — List & audit:** events list (upcoming / past / cancelled tabs) with booked/capacity counts; `event.created/published/updated/cancelled/completed` audits.

---

## Story 21.3 — Publish → Announce (Epic 19 Integration)

**As a** hotel user publishing an event,
**I want** guests to hear about it without a second workflow,
**so that** the events channel fills the announcements channel, not my todo list.

### Acceptance Criteria

- **AC1 — The checkbox:** the publish step offers "أعلن للضيوف" (default on): creates a linked announcement through the standard pipeline — title, a short auto-composed body per language from the event's translations, and an **event deep-link chip** (the Epic 17 info-chip pattern, pointing into the Events tile).
- **AC2 — Standard behavior:** the generated announcement is a normal announcement afterward (visible in history, retractable independently, read-stats included) — badged "auto · event" for clarity. Audience: all current guests (targeted audiences per event = deferred).
- **AC3 — No loops:** cancelling the event's cancellation notice (21.2 AC3) and this publish notice are independent records; retracting the publish announcement never touches the event.

---

## Story 21.4 — Guest: Browse & Book

**As a** guest,
**I want** to see what's happening and grab a spot in three taps,
**so that** my vacation plans itself from the sunbed.

### Acceptance Criteria

- **AC1 — Tile & list:** the Events tile activates (module `events`). Upcoming events as photo cards — date/time (localized), location, price **or ✓Included** per my stay type, spots-left hint when capacity is tight ("متبقي 3 أماكن"), sold-out and past states designed. Guest language w/ EN fallback throughout.
- **AC2 — Detail & booking sheet:** full description, then book — **party size** stepper (capped by remaining capacity and a sane per-stay max, default 6), payment method when paid (from the hotel-level config: cash at event / room charge — the F&B sheet's pattern), fully-included bookings skip payment (16.4 AC3 continuity). Price × party size totals live.
- **AC3 — Capacity is race-safe:** two guests grabbing the last spot — one succeeds, one gets a friendly "الأماكن اكتملت للتو" with the sheet refreshing (row-lock discipline like rooms/seats). Overbooking is impossible by construction, tested.
- **AC4 — Booking record:** snapshot (event title ×languages, time, price, included flag, party size, method) — event edits never rewrite my booking card.

---

## Story 21.5 — Guest: My Bookings

**As a** guest,
**I want** my plans visible and cancellable,
**so that** booking feels safe.

### Acceptance Criteria

- **AC1 — My bookings:** inside the Events tile — upcoming bookings first (event, time, party size, payment status line), past/cancelled collapsed. **Today's booking surfaces as a home strip** ("رحلة الغوص اليوم 3:00 مساءً") — the Epic 19 banner slot's pattern, non-dismissable until past.
- **AC2 — Cancel:** free self-cancel until event start (releases capacity instantly); cancelled paid-room-charge bookings drop from the unsettled sum. Post-start, the UI points to the front desk.
- **AC3 — Session rules as everywhere:** checkout kills access; bookings live on the stay (history preserved hotel-side).

---

## Story 21.6 — Attendees & Settlement

**As a** hotel user with `events.read`,
**I want** the attendee list and the money to reconcile themselves,
**so that** running the event needs a phone, not a spreadsheet.

### Acceptance Criteria

- **AC1 — Attendees:** per event — bookings list (guest, room, party size, payment method, booked at), live totals (booked / capacity, expected cash vs room-charge sums). Exportless MVP (Reports epic covers exports).
- **AC2 — Settlement continuity:** room-charged bookings join the stay's **unsettled sum** exactly like F&B orders (16.8's interlock shows one combined total at checkout; the bulk settle covers both kinds — extend the existing flow, don't fork it).
- **AC3 — Attendance check-off:** deferred (recorded) — MVP trusts the list.

---

## Implementation Notes for Claude Code

1. **Refactors first, separate commits (21.1):** sharp extraction verified by the three consumers' existing tests staying green; payment lift's migration moves values then drops/deprecates the old columns; F&B settings page relocation keeps a guidance pointer. Only then start Events.
2. **Entities:** `events` (translations JSONB, photo key, start/end, location text + `info_entry_id?`, capacity?, price?, `included_for` array, status, cancel reason) + `event_bookings` (event, stay, party_size, snapshot JSONB, payment_method?, status booked|cancelled, cancelled_by guest|staff|system, settled ride-along per the 16.8 mechanism). Capacity check + booking insert in one transaction with the event row locked.
3. **Pricing resolution:** reuse/extend the single pricing-function discipline (16 note 3) — `(event, stayType, partySize) → {included, total}` — one function, both surfaces, server recomputes on booking.
4. **Auto-announcements:** call the announcements service (not its HTTP layer) with a `source: event` marker; the cancel notice targets stay ids of booked guests (the audience filter already supports it — the "one specific guest" path generalized to a stay-id list; smallest possible extension, record it).
5. **Completion tick:** the 5-minute job flips `published → completed` past end (or start+3h default when endless); completed events leave the guest list, keep hotel history.
6. **Guest screens:** dynamic chunk like dining; photo cards via the shared pipeline renditions; the booking sheet reuses the F&B sheet's structure (stepper, method row, totals). Device-pass note: the events list with photos is a bundle-budget watchpoint — lazy strictly.
7. **Tests:** capacity race, party-size caps, pricing matrix (free/paid/included × stay types), safe-edit matrix on published, cancel cascade (bookings + targeted notice + capacity release + settlement drop), auto-completion, settlement combined-total math, seven-locale + AR/EN parity, module gating. Builds + budgets green.

---

## Recorded decisions (implementation, 2026-08-30)

1. **Safe edits keep the words open, lock the terms.** Titles and descriptions stay editable on a `published` event (fixing a typo must not require cancel-and-recreate); every booking snapshots the guest's own terms (title ×languages, schedule, location, price, included flag), so a later edit can never rewrite what a guest already agreed to. Capacity on a published event may only rise or go to `null` (unlimited) — including from `null`, where a *finite* new value is a reduction against an unbounded booked count and 409s `EVENT_NOT_SAFE_EDIT`. Schedule/price/`included_for`/location/info-link stay locked; `completed`/`cancelled` lock everything (photos included).
2. **Booking closes at the event's start, server-side.** Status alone can't carry this: the completion tick only flips `published → completed` at `endAtLocal` (or start+3h), so a started event stays `published` for hours, and the client's "already started" guard runs on the *device* clock. `book()` compares `hotelLocalStamp(hotel.timezone, now)` against `startAtLocal` inside the locked transaction and 409s **`EVENT_NOT_BOOKABLE`** — the existing code, reused deliberately (frontends already translate it; the guest-facing meaning is identical). `getDetail()` is NOT gated (a started event stays viewable so deep links keep working); `listUpcoming` is already future-filtered.
3. **No delta-cursor endpoint for guest event bookings.** Unlike Requests/F&B/Announcements, the events surfaces are low-cardinality and low-churn per stay, so clients full-refetch `GET /guest/events` and `/guest/events/my-bookings` on mount and pull-to-refresh. If Epic 23 (push) makes a live attendee/booking feed necessary, the Epic 19 tombstone-delta pattern is the one to copy.
4. **Stay settlement is not transactional across sources** — known follow-up. `StaySettlementService.settle()` calls each `SettlementSource.markSettled()` in turn without a shared transaction; a source failing midway leaves earlier sources settled. Mitigated, not solved: each source's write is internally atomic, the operation is idempotent (a re-run settles only what's left), and the response's `unsettledTotal` is **re-read from every source after the writes** — so a charge placed mid-settle (or a partial failure) resurfaces on the drawer immediately instead of reading a hardcoded zero. The audit entry is written only when something actually moved (the legacy F&B route's behavior).
5. **Guest self-cancel is exempt from the subscription lockout.** `cancelOwn()` deliberately skips the module/read-only/suspension gate every other guest event route applies: it is a **state-reducing** operation — it releases capacity back to the hotel and reduces the guest's own payment obligation. Locking it would strand a guest in a booking they can't cancel, and in a room charge they'd still owe, because the *hotel's* subscription lapsed. State-*adding* writes (`book`) stay locked out normally.
6. **Auto-announcements respect the announcements module.** Publish/cancel notices call `TenantAnnouncementsService` directly, bypassing the `@RequireModule('announcements')` guard that only gates the HTTP layer, so both call sites check `TenantAccessService.getAccessState().enabledModules` first — a hotel with `events` but not `announcements` in its plan publishes successfully and silently creates no notice (logged, never an error). The cancel notice passes an internal `dropUnresolvedStays` flag so a guest checking out between the attendee filter and the audience re-validation can't 400 the notice away for everyone still in the hotel; the public compose route keeps its strict all-or-400 stay-id validation.

---

## Notes & Dependencies

- **Depends on:** Epics 13–19 machinery; executes the recorded sharp + payment extractions (memory items).
- **Feeds:** Epic 22 Reports (events revenue/attendance), Epic 23 Push (the killer use case: "ورشة اليوجا بعد ساعة"), Epic 24 Laundry (inherits both 21.1 extractions ready-made).
- **Deferred:** recurring events, waitlists, targeted event audiences, attendance check-off, ticket QRs, non-guest (walk-in) bookings, exports.
