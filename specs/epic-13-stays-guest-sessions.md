# Epic 13 — Stays & Guest Sessions

> **Scope:** The bridge between rooms and guests. Front desk checks guests in from the Tenant Dashboard; the system generates a **stay code**; guests use it (per the Epic 11 URL contract) to open authenticated guest sessions. Covers the stay lifecycle (check-in → extend/change room → checkout, manual + automatic), the **guest session backend contract** the Guest App will consume, strict brute-force protection, and room occupancy surfacing.
>
> **Out of scope:** The Guest App UI itself (next epic — it consumes the session contract defined here), WhatsApp delivery of codes (future channel), PMS integration (future phase — check-in is manual by design for this market).
>
> Standing conventions (isolation, guards order, audit, i18n, guidance DoD, token hygiene) live in the repo CLAUDE.md files and apply throughout; this spec covers only what's new.
>
> **Tenant permission catalog additions:** `stays.read`, `stays.checkin`, `stays.update`, `stays.checkout`
> Seeded roles: Manager + Front Desk get all four; Housekeeping gets none. Owner `*` as always.

---

## Story 13.1 — Check-In (Create Stay)

**As a** front desk user with `stays.checkin`,
**I want** to check a guest into a room in under a minute,
**so that** every arriving guest leaves the desk with a working stay code.

### Acceptance Criteria

- **AC1 — Form:** guest name (required), room (required — picker shows **available** `active` rooms only: no current active stay), check-in date (default today), check-out date (required, > check-in), guest language (required — dropdown of the 7 guest languages: ar, en, ru, fr, it, es, de; default = hotel `default_language` if in the list, else `en`), optional: email, phone, guests count, note.
- **AC2 — One active stay per room:** Enforced at the DB level (partial unique index on `room_id` where status = `active`). Race-safe: two simultaneous check-ins to the same room — one succeeds, one gets `409 ROOM_OCCUPIED`.
- **AC3 — Stay code generation:** On creation, a **6-digit numeric code** is generated: unique among the hotel's `active` stays, cryptographically random, never sequential. Stored **hashed** (verification by hash compare); retrievable in plaintext only via the reveal flow (13.3 AC3) which re-derives nothing — so the plaintext is stored encrypted-at-rest OR regenerate-on-forget is the model: **choose the simpler: store hashed only; forgetting the code = regenerate (13.3 AC4).** The code is displayed prominently on the success screen with a copy button and a "hand this to the guest with the room card" instruction.
- **AC4 — Optional email delivery:** If an email was entered, queue a `stay_code` email (typed-TS template) through the notifications pipeline: guest's language when `ar`/`en`, otherwise `en` for now (full 7-language templates arrive with the Guest App localization epic — leave the resolution function ready for it). The email includes the guest app link (`/{slug}`), room number, and code.
- **AC5 — Audit:** `stay.checked_in` (guest name, room, dates — never the code).

---

## Story 13.2 — Stays List & History

**As a** hotel user with `stays.read`,
**I want** to see current and past stays,
**so that** the desk always knows who is where.

### Acceptance Criteria

- **AC1 — Active view (default):** room, guest name, dates, nights remaining, language flag/label, status. Sorted by room natural order. Search by guest name or room; filter by floor.
- **AC2 — History view:** past stays (`checked_out`) with checkout type (manual / automatic), searchable, paginated. Stays are permanent records — no delete anywhere.
- **AC3 — Occupancy in Rooms:** the Epic 11 rooms list occupancy placeholder activates: occupied/vacant badge per room; occupied rooms show guest name + checkout date in an InfoTip (visible only with `stays.read`).

---

## Story 13.3 — Manage a Stay

**As a** hotel user with `stays.update`,
**I want** to extend, move, and fix stays,
**so that** real-life changes never require support.

### Acceptance Criteria

- **AC1 — Extend / shorten:** edit check-out date (must remain > check-in and ≥ today). Sessions continue untouched. Audit `stay.dates_changed` with old/new.
- **AC2 — Change room:** move the stay to another available room (same availability + race rules as 13.1 AC2). Code and sessions continue working; the guest notices nothing. Audit `stay.room_changed`.
- **AC3 — View code:** the stay detail shows the code **masked** with a "reveal" action (gated `stays.update`, audit `stay.code_revealed`) — *only if* the chosen storage model keeps a recoverable copy; with hash-only storage this action is replaced by "Regenerate" (AC4). *(Implementation picks hash-only per 13.1 AC3 — so: no reveal, regenerate instead.)*
- **AC4 — Regenerate code:** issues a new 6-digit code (same rules), **invalidates the old one immediately** (existing guest sessions survive — only new logins need the new code), shows it once. For "guest forgot the code" at the desk. Audit `stay.code_regenerated`.
- **AC5 — Edit guest info:** name, email, phone, language, guests count, note — audit `stay.updated` with diff. Changing language updates future notifications and (later) the guest app default.

---

## Story 13.4 — Checkout (Manual + Automatic)

**As a** hotel user with `stays.checkout` (and as the platform),
**I want** stays to end cleanly whether or not the desk remembers,
**so that** access always dies with the stay.

### Acceptance Criteria

- **AC1 — Manual checkout:** one action with ConsequenceNote ("سيتم إنهاء الإقامة وتسجيل خروج الضيف من التطبيق فورًا"). Status → `checked_out` (`checkout_type = manual`), **all guest sessions for the stay become invalid on their next request** (see 13.5 AC4). Room becomes available instantly. Audit `stay.checked_out`.
- **AC2 — Checkout hour setting:** the hotel gets a `checkout_time` setting (default **12:00**, hotel timezone), editable in a small "Stay settings" card on the stays page (gated `stays.update`, guidance included).
- **AC3 — Auto-checkout job:** a daily job (idempotent, same pattern as trial expiry) closes `active` stays whose check-out date + `checkout_time` has passed → `checked_out` (`checkout_type = automatic`). Extensions naturally rearm it (AC via 13.3 AC1).
- **AC4 — No resurrection:** a `checked_out` stay is final. Guest returns next week = new check-in, new code, new stay record.

---

## Story 13.5 — Guest Session Contract (Backend, Public)

**As the** Guest App (next epic),
**I want** a complete, hardened session API,
**so that** the guest UI only has to render it.

### Acceptance Criteria

- **AC1 — Entry endpoint:** `POST /guest/{slug}/session` with body `{ room_number, code }`. Per the Epic 11 URL contract: the Guest App sends `room_number` from the `?room=` param when present, or from user input (banner flow). Success → guest JWT (distinct audience `guest`, carrying `stay_id` + `hotel_id` + guest language) + minimal profile `{ guestName, roomNumber, hotelName, language, checkOutDate }`.
- **AC2 — Failure behavior:** wrong room/code combinations return one generic error (`INVALID_CODE`) — never distinguishing "room has no stay" from "wrong code" (no occupancy enumeration). Suspended hotel → `HOTEL_UNAVAILABLE`; unknown slug → 404.
- **AC3 — Brute-force protection (critical — codes are 6 digits):** layered rate limits: per IP+room (e.g., 5 attempts / 15 min, then temporary lockout with escalating duration) **and** per hotel per IP (e.g., 30 attempts / hour — blocks room-scanning across the hotel). Lockouts return `TOO_MANY_ATTEMPTS` with retry-after. Limits env-tunable; events logged for future alerting.
- **AC4 — Session validity is stay validity:** every guest-authenticated request verifies the stay is still `active` (per-request check, short cache ≤ 30s acceptable). Checkout/suspension therefore kills all devices within seconds without server-side session storage. Token expiry itself = check-out date + 1 day buffer (extensions re-issue on next entry or continue via the stay check — token exp is the backstop, the stay check is the authority).
- **AC5 — Multi-device by design:** the same code opens sessions on any number of devices (family phones). No device limit in MVP.
- **AC6 — Session probe:** `GET /guest/me` returns the minimal profile (for app boot: "session still valid?") — same stay-validity check, same generic 401 when dead.

---

## Implementation Notes for Claude Code

1. **Entities:** `stays` (`id, hotel_id, room_id, guest_name, email?, phone?, language, guests_count?, note?, code_hash, check_in_date, check_out_date, status active|checked_out, checkout_type manual|automatic|null, checked_out_at/by`), partial unique index (`room_id` where `status='active'`), `checkout_time` column on hotels. Migration ships in the same PR (per CLAUDE.md — infra is live).
- **Code handling:** generate with CSPRNG; uniqueness check against active stays' hashes requires a deterministic lookup — store `code_hash` as HMAC-SHA256 with a server secret (deterministic → indexable uniqueness + O(1) login lookup by (`hotel_id`, `code_hash`)). Never log or audit plaintext. Regeneration = new hash, old sessions untouched (session validity rides on the stay, not the code).
2. **Guest auth strategy:** third JWT strategy/audience (`guest`) alongside admin + tenant — same never-cross rules. Guest routes live under a distinct public tree (`/api/guest/...`); only 13.5's endpoints exist in it for now.
3. **Rate limiting:** dedicated guard/store for the layered limits (in-memory per instance is acceptable now; keep the interface swappable for Redis later). Include the lockout state in tests.
4. **Availability service:** one function answers "is room X available for a stay?" — used by check-in, room-change, and (11.4 AC2's now-active rule) blocking `out_of_service`/`inactive` transitions on occupied rooms. Lock the room row in-transaction (same discipline as Epic 11 bulk).
5. **Tenant UI:** Stays section (list active/history tabs, check-in page or modal — follow the app's pattern, stay detail drawer with actions, settings card). Room picker groups by floor, shows only available rooms, searchable. Full Epic 12 guidance DoD: the check-in form is the most-used screen in the product — its FieldHelp/examples deserve the best copy in the app (e.g., language field: "لغة الضيف — سيصله التطبيق والإشعارات بهذه اللغة").
6. **Rooms integration:** occupancy badge/InfoTip on the rooms list (data joined efficiently — no N+1), and the room detail shows current stay (with `stays.read`).
7. **Auto-checkout job:** hotel-timezone-aware (compare against `check_out_date` + `checkout_time` in the hotel's timezone). Idempotent; emits `stay.checked_out` audits with `automatic`.
8. **Email template:** `stay_code` in AR + EN typed-TS templates; language resolution: guest language if `ar`/`en` else `en` — extend the single resolution function, note the 7-language expansion point.
9. **Occupancy + availability tests:** race on double check-in, room-change race, out_of_service-on-occupied 409, auto-checkout timezone edges (23:00 vs 01:00 boundaries), rate-limit lockout + escalation + per-hotel layer, stay-validity kill (checkout → guest 401 within cache window), code uniqueness among active stays, regenerate keeps sessions. Component tests for check-in form + occupancy InfoTip.

---

## Notes & Dependencies

- **Depends on:** Epic 11 (rooms, URL contract), Epics 04–10 machinery. Guidance kit per Epic 12 DoD.
- **Blocks:** Guest App epic (consumes 13.5 verbatim), Guest Requests epic (requests attach to stays), future analytics (occupancy data starts accumulating now).
- **Deferred:** WhatsApp code delivery, multiple named guests per stay, reservations/future bookings (check-in is walk-up/on-arrival only — a booking module is a separate product decision), PMS sync, device management for guest sessions.
