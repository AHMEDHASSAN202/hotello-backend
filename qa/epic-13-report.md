# QA Report — Epic 13: Stays & Guest Sessions

- **Suite:** `hotello-backend/qa/tests/epic-13/` (Playwright, 7 spec files, 46 tests)
- **Surfaces under test:** hotello-backend API (`/api/v1` tenant + public guest trees), hotello-hotel-frontend tenant dashboard (`:3001`)
- **Stack:** local dev stack (Postgres 16, API :4000, tenant app :3001), migrations + seed applied
- **Result: 46 passed / 0 failed.** No product defects found in this epic. Three observations recorded below (no AC violated).
- **Isolation model:** rate-limit and guest-session suites run against dedicated per-run hotels (lockouts would poison shared state); list/history suites use fresh hotels per test; worker-shared hotels use per-file room ranges and timezone pinned to UTC for deterministic date math.

---

## Findings

**None.** Every acceptance criterion that is E2E-testable passes, including the critical paths: the double check-in race (one 201, one `409 ROOM_OCCUPIED`), room-change race, plan-safe seat behavior, session death on checkout, code regeneration semantics, and the layered brute-force protection with exact failure accounting (17 + 13 = 30 recorded failures trip the per-hotel layer; valid logins are then refused with `TOO_MANY_ATTEMPTS` + `retryAfterSeconds`).

### Observations (no AC violated; for product awareness)

1. **The coarse route throttle's 429 has no stable code.** Besides the spec'd layered limits (`TOO_MANY_ATTEMPTS` + `retryAfterSeconds` — correctly shaped), `/guest/*` carries a coarse `@Throttle` 30/min/IP whose rejection is a generic NestJS 429 with **no `code` and no `retryAfterSeconds`**. A Guest App client cannot distinguish "brute-force lockout" from "route saturation" — the app's error map (per its CLAUDE.md contract) has no entry for an unlabeled 429. Sustained >30 logins/min from one IP is plausible on hotel WiFi where many guests share one public IP. Suggestion (no fix applied): label the route-throttle rejection with the same `TOO_MANY_ATTEMPTS` shape.
- **Where it surfaced:** `qa/tests/epic-13/13-7-ui-stays.spec.ts` during full-suite runs (harness retries generic 429s via `guestSessionSteady` — infrastructure, not an assertion target).
2. **Same-second multi-device tokens are byte-identical.** Guest JWTs carry second-granularity `iat`; two logins in the same second with the same claims produce the exact same token string. Functionally irrelevant (stateless, both valid, 13.5 AC5 satisfied — asserted by independent validity), noted so nobody mistakes a shared token string for a session bug.
3. **Stay dates are hotel-timezone naive.** `nightsRemaining`/auto-checkout compare against hotel-local today (default `Africa/Cairo`). Guests checking in "today" late at night in a UTC+X hotel see correct local behavior; QA had to pin test hotels to `timezone: UTC` to keep date arithmetic deterministic. No action needed — documented for future epics touching dates.

---

## Coverage matrix (AC → tests)

| AC | What was tested | Where |
|---|---|---|
| 13.1 AC1 | Check-in happy path (all optional fields, 6-digit code, `nightsRemaining`); validation: empty name, `INVALID_STAY_DATES`, language outside the 7 guests, bad email; check-in into `out_of_service` → `409 ROOM_NOT_AVAILABLE`, unknown room → `404 ROOM_NOT_FOUND`; available-rooms picker excludes occupied + non-active rooms and is naturally ordered | 13-1, 13-2 |
| 13.1 AC2 | Sequential double check-in → `409 ROOM_OCCUPIED`; simultaneous race → exactly one 201 + one 409 | 13-1 |
| 13.1 AC3 | Code format `^\d{6}$`; hash-only storage (stay view/API never exposes `codeHash`) | 13-1 |
| 13.1 AC4 | `stay_code` outbox row: `language='ar'` for ar guests, `en` fallback for fr; persisted HTML is the **masked** render (contains room + app link, never the plaintext code); no email queued without an address | 13-1 (DB verification) |
| 13.1 AC5 | `stay.checked_in` audit with guest/room/dates; plaintext code absent | 13-1 (DB verification) |
| 13.2 AC1 | Active view: natural room order, search by guest + by room, floor filter, `nightsRemaining` | 13-2 |
| 13.2 AC2 | History: `checked_out` only, `checkoutType='manual'`, newest first, search by guest and by room number; permanence (no delete endpoint → 404/405) | 13-2 |
| 13.2 AC3 | `currentStay` present for `*`/`stays.read`, **absent as a field** for rooms.read-only staff; room detail shows the stay; UI Occupied badge; carried Epic 11 rules now live: occupied room cannot go `out_of_service`/`inactive` (`409 ROOM_OCCUPIED`), renumbering a room with stay history → `409 ROOM_HAS_STAY_HISTORY` | 13-2, 13-7 |
| 13.3 AC1 | Extend (200, `stay.dates_changed` audit with from/to, guest session survives); checkout ≤ check-in / in the past → `400 INVALID_STAY_DATES` | 13-3 |
| 13.3 AC2 | Change room: occupied target 409, same-room no-op 200, move → old room freed + new occupied, `stay.room_changed` audit (from/to), **same code logs into the new room**, old room+code dead; concurrent moves into one room → one 200 + one 409 | 13-3 |
| 13.3 AC3 | Reveal flow intentionally does not exist (hash-only) — the UI "New code" (regenerate) flow is tested instead | 13-7 |
| 13.3 AC4 | Regenerate: new code ≠ old, old code `401 INVALID_CODE` immediately, new code works, pre-existing session survives, `stay.code_regenerated` audit (never contains the code) | 13-3 (API), 13-7 (UI) |
| 13.3 AC5 | Guest info edit (name/email/phone/language/guestsCount/note) + `stay.updated` audit with diff | 13-3 |
| 13.4 AC1 | Manual checkout: status/`checkoutType`/`checkedOutAt`, `stay.checked_out` audit, room instantly re-checkin-able, guest session dead on next request (polled ≤30s window), re-entry `INVALID_CODE` | 13-4 |
| 13.4 AC2 | Settings: default `12:00`, PATCH → `14:30` audited as `hotel.updated` with diff, `25:99` → 400, `stays.read`-only user → 403 | 13-4 |
| 13.4 AC3 | Precondition only: an expired-date stay is still active beforehand (see "not testable" — the hourly job is not triggerable over HTTP) | 13-4 |
| 13.4 AC4 | No resurrection: edit / regenerate / change-room / checkout-again on a checked-out stay → `409 STAY_NOT_ACTIVE` | 13-3 |
| 13.5 AC1 | `POST /guest/{slug}/session` `{roomNumber, code}` → guest JWT + profile (guestName, roomNumber, hotelNameEn/Ar, slug, language, checkOutDate, stayType, stayId, dndActive); `/guest/me` probe; room-number trim/case tolerance; 5-digit code → 400 | 13-5 |
| 13.5 AC2 | Wrong code / wrong room / right-code-wrong-room → byte-identical `401 INVALID_CODE`; unknown slug → `404 HOTEL_NOT_FOUND`; suspended hotel → `403 HOTEL_UNAVAILABLE` | 13-5 |
| 13.5 AC3 | Per-room: 5 failures → lockout; correct code refused during lockout (`TOO_MANY_ATTEMPTS` + `retryAfterSeconds`); other rooms unaffected; success clears the room bucket; per-hotel 30/hour: exact accounting (17+13 recorded failures) blocks even valid logins | 13-6 |
| 13.5 AC4 | Session validity = stay validity: checkout kills the session; extensions/room changes/regeneration keep it | 13-3, 13-4 |
| 13.5 AC5 | Same code opens two sessions, both independently valid | 13-5 |
| 13.5 AC6 | `/guest/me` probe; JWT `aud='guest'` + `hotelId`; garbage/missing token → 401; guest token on tenant routes → 401 (third auth universe) | 13-5, 13-4 |
| Cross-tenant | Stay detail/patch from another hotel → 404 | 13-3 |
| UI | Check-in modal → success screen shows the code once → that exact code opens a guest session; stays board rows; checkout with confirm → detail shows ended state → history tab shows `Manual`; settings card edit; regenerate shows the new code once in the code card | 13-7 |

---

## Criteria NOT testable end-to-end (and why)

| AC | Reason |
|---|---|
| 13.4 AC3 — auto-checkout **execution** | The job runs hourly in-process (`AutoCheckoutService`, Intl-based hotel-local comparison) with no HTTP trigger; waiting for a tick is nondeterministic. The observable precondition (expired stay still active before the job) is covered; the job's logic is unit-tested in the backend (`auto-checkout.service.spec.ts`, including timezone edges). If a manual "run now" admin hook ever exists, an E2E test should follow. |
| 13.1 AC4 — full 7-language email templates | Deferred by the spec itself (ar/en now, `resolveGuestEmailLanguage` fallback otherwise — the fallback **is** tested). |
| 13.3 AC3 — reveal flow | Deliberately not built (hash-only storage, recorded decision). Verified implicitly: no reveal endpoint exists; regenerate replaces it. |
| 13.5 AC4 — the ≤30s cache **upper bound** | The implementation checks per-request (kill observed immediately), so the cache ceiling is unobservable from outside. |
| WhatsApp delivery / PMS integration | Explicitly out of scope this epic. |

---

## Harness notes for future epics

- `qa/helpers/stays.ts` exposes `checkInOk` (returns stay + plaintext code), `guestSessionOk`, `guestSessionSteady` (retries the unlabeled route-throttle 429s), `listStays`, and date helpers aligned to the QA hotels' pinned `UTC` timezone — Epics 14–20 (requests, F&B, housekeeping…) build directly on these.
- The rate-limit spec's failure accounting depends on test order; it is declared `serial`. Do not convert it to `fullyParallel`.
- Guest-login failures are permanently counted per (IP, hotel) for one hour — any new suite that makes failed guest logins must use its own provisioned hotel, or keep failures below the budget.
