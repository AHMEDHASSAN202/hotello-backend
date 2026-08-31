# QA Report — Epic 11: Rooms Management & QR Codes

- **Suite:** `hotello-backend/qa/tests/epic-11/` (Playwright, 9 spec files, 74 tests)
- **Surfaces under test:** hotello-backend API (`/api/v1`), hotello-hotel-frontend tenant dashboard (`:3001`)
- **Stack:** local dev stack (`./dev.sh backend tenant`), Postgres 16 via docker compose, migrations applied, seed applied
- **Result: 73 passed / 1 failed** — the single failure is a verified product bug (QA-11-001).
- **Determinism:** every test seeds its own data through the real API (hotel onboarding → owner setup → login); worker-scoped hotels with per-suite room-number ranges; global setup/teardown deletes every `qa-*` hotel via SQL (QA-only slug namespace; no hard-delete API exists). Login rate limits are respected with a cross-process pacer (`helpers/throttle.ts`), so the suite runs ~16 minutes.

---

## Findings

### QA-11-001 — Excel import reports a filled-but-unknown room type as `REQUIRED`, not `UNKNOWN_TYPE`

- **ID:** QA-11-001
- **Severity:** minor
- **Acceptance criterion violated:** 11.7 AC4 (per-row validation results: "duplicate number, **unknown type**, bad status, empty required") — read together with 11.7 AC2's template guidance ("Pick from the dropdown — manage types in Rooms → Types").
- **Steps to reproduce:**
  1. As a tenant owner, build an `.xlsx` in the template shape with a data row whose Type cell contains a name that does not match any hotel room type (e.g. `NoSuchType`), all other cells valid.
  2. `POST /api/v1/tenant/rooms/import/preview` with that file (multipart `file`).
  3. Inspect the issue array of that row.
- **Expected vs actual:**
  - **Expected:** issue `{ field: "roomTypeId", code: "UNKNOWN_TYPE" }` — the stable code exists in `room-rows.ts` and has a dedicated translation in the tenant dashboard (`rooms.excel.import.issue.UNKNOWN_TYPE` = "This room type doesn't match any of your room types.").
  - **Actual:** issue `{ field: "roomTypeId", code: "REQUIRED" }` — the UI would tell the user "This field is required." for a cell they *did* fill in. The `UNKNOWN_TYPE` branch is dead code on the import path.
- **Failing test:** `qa/tests/epic-11/11-7-excel.spec.ts` › `11.7 AC4 — import preview reports per-row errors (unknown type, bad status, empty)`
- **Repo/area (best guess, no fix applied):** hotello-backend — `src/modules/tenant-rooms/xlsx/parse-import.ts` maps an unmatched type *name* to `roomTypeId: null`, and `src/modules/tenant-rooms/room-rows.ts` (`validateRoomRows`) emits `REQUIRED` for any falsy `roomTypeId`, so the parser cannot distinguish "cell left empty" from "name not found". The UI-facing translation lives in hotello-hotel-frontend `messages/en/rooms.json`.
- **Verification performed:** reproduced with a hand-built workbook via a raw authenticated API call outside the suite (same `REQUIRED` response), and confirmed by code reading that the `UNKNOWN_TYPE` branch can only fire on the range path (non-null-but-foreign UUID), never on imports.

### QA-11-002 — Amber usage warning triggers at exactly 80%; spec says "exceeds 80%"

- **ID:** QA-11-002
- **Severity:** cosmetic
- **Acceptance criterion violated (boundary reading):** 11.2 AC3 — the >80% indicator "pattern from Epic 04, Story 4.6 AC3", which is worded "a visual indicator when usage **exceeds** 80% of any limit".
- **Steps to reproduce:**
  1. Onboard a hotel on a plan with `maxRooms = 5`; create 3 rooms → rooms page badge shows `3 / 5 rooms`, not amber.
  2. Create a 4th room (exactly 80%) → reload.
- **Expected vs actual:**
  - **Expected (strict reading):** no amber at exactly 80%; indicator only when usage *exceeds* 80%.
  - **Actual:** badge is amber at exactly 80% (`usageAmber` computes `used / max >= 0.8` in the tenant frontend rooms page). 60% is correctly not amber.
- **Failing test:** none — the boundary behavior is deliberately asserted in `qa/tests/epic-11/11-9-ui-rooms.spec.ts` › `11.2 AC3 — usage badge shows used vs plan max; amber from 80% (spec: >80%)`, which documents both sides of the boundary and passes. Recorded here so product can decide whether the threshold should be exclusive.
- **Repo/area (best guess):** hotello-hotel-frontend — `src/app/t/[slug]/(dashboard)/rooms/page.tsx` (`usageAmber`).

### QA-11-003 — QR PDFs are not byte-stable across regeneration (QR codes are)

- **ID:** QA-11-003
- **Severity:** cosmetic / informational
- **Acceptance criterion touched:** 11.5 AC4 ("regenerating PDFs anytime yields identical codes").
- **Evidence:** two consecutive `GET /tenant/rooms/pdf/poster?size=a4` responses have different MD5s (PDF embeds render timestamps), while two consecutive room-QR PNGs are byte-identical, and decoded QR payloads are identical (`…/{slug}?room=N`). The spec's "identical **codes**" is satisfied; byte-level file stability is not, and arguably not intended.
- **Failing test:** none — `qa/tests/epic-11/11-5-qr-pdfs.spec.ts` › `11.5 AC4 — regeneration is byte-identical for QRs (derived, nothing stored)` asserts QR byte-identity and only PDF validity for the poster.
- **Repo/area:** hotello-backend — `src/modules/tenant-rooms/pdf/pdf-renderer.service.ts` (Chromium print-to-PDF timestamps). No action required unless byte-stable PDFs become a requirement.

---

## Observations (no AC violated)

1. **Public auth endpoints are aggressive for NAT'd offices.** Admin login, tenant login and `POST /tenant-users/setup` are all 5/min **per IP**. A hotel front desk behind one shared IP doing staff onboarding in the morning will hit 429s with legitimate traffic. The E2E harness itself needed a cross-process pacer to run deterministically against this (see `qa/helpers/throttle.ts`). Worth a product look when real offices hit it.
2. **Natural sort / floor ordering is well-implemented.** Numeric-aware ordering (`2 < 7 < 10 < 99 < 100 < 101 < 101A < 102 < 110`), leading-zero numbers surviving as text, unset floors sorting last — all verified at API and UI level.
3. **Plan-limit seat accounting is solid.** Single + bulk 409s carry `limit/used/remaining`, bulk previews surface remaining seats, inactive rooms free seats while out-of-service ones hold them, and a concurrency race (two simultaneous bulk commits vs 5-room plan) resolves to exactly one winner under the hotel row lock.
4. **QR URL contract is exact.** Decoded payloads: general → `GUEST_APP_BASE_URL/{slug}`; room → `GUEST_APP_BASE_URL/{slug}?room={number}`. Nothing persisted; PNG regeneration is byte-identical.

---

## Coverage matrix (AC → tests)

| AC | What was tested | Where |
|---|---|---|
| 11.1 AC1 | Type create (EN+AR+descriptions), edit, deactivate/reactivate, name uniqueness per hotel per language (409 `ROOM_TYPE_NAME_TAKEN`, EN and AR) | 11-1 (API), 11-9 (UI create) |
| 11.1 AC2 | Seeded Standard/Deluxe/Suite with AR names, active | 11-1, fixture |
| 11.1 AC3 | Deactivate guard with rooms assigned → 409 `ROOM_TYPE_IN_USE` **with count** | 11-1 (API), 11-9 (UI shows count message) |
| 11.2 AC1 | `rooms.read`-less user: 403 on rooms/room-types/QR endpoints; nav hides Rooms; direct URL → no-access screen; `rooms.read`-only user cannot create | 11-2 (API), 11-9 (UI) |
| 11.2 AC2 | List fields, natural sort, floor nulls-last, floor/type/status filters, search | 11-2 (API), 11-9 (UI order) |
| 11.2 AC3 | `usage {used, max}` counting active+out_of_service (inactive excluded); badge text; amber boundary (see QA-11-002) | 11-2 (API), 11-9 (UI) |
| 11.3 AC1 | Single create, alphanumeric + leading-zero numbers, format validation 400s, duplicate 409 with number, unknown type 404 | 11-3 (API), 11-9 (UI duplicate error) |
| 11.3 AC2 | Bulk preview: exact rows, exclusions, per-number duplicates, remaining seats; inverted range + >500 cap 400s (`BULK_RANGE_INVALID` / `BULK_RANGE_TOO_LARGE`); UI preview→confirm flow | 11-3 (API), 11-9 (UI) |
| 11.3 AC3 | Single + bulk over-limit 409 `ROOM_LIMIT_REACHED` with details; preview remaining; inactive frees seats; no tenant-side force; concurrency race | 11-3, 11-6 |
| 11.3 AC4 | Atomic commit: duplicate without skip → 409, zero rooms created; skip-duplicates path creates the rest | 11-3 |
| 11.3 AC5 | `room.created` + `rooms.bulk_created` audit rows (count + range in metadata) | 11-3 (DB verification) |
| 11.4 AC1 | Edit floor/type; renumber allowed without stay history; renumber collision 409 | 11-4 |
| 11.4 AC2 | Full status cycle incl. out_of_service ↔ inactive; invalid status 400 | 11-4 |
| 11.4 AC3 | `room.updated` audit with diff | 11-4 (DB verification) |
| 11.5 AC1 | Poster PDF A4/A5 (`application/pdf`, `%PDF-` magic, filename), invalid size 400 | 11-5 |
| 11.5 AC2 | Cards PDF: all / floors / specific-room scopes; >100 roomIds 400; empty scope 400 | 11-5 |
| 11.5 AC3 | Room QR PNG + SVG endpoints, general QR, UI modal shows image + raw guest link | 11-5 (API), 11-9 (UI) |
| 11.5 AC4 | QR payload == derived guest URL (decoded PNG); byte-identical regeneration (see QA-11-003) | 11-5 |
| 11.6 AC1 | Admin hotel profile reflects derived count (active+oos; inactive excluded) | 11-6 |
| 11.6 AC2 | `roomsCount`/`declaredRoomsCount` rejected as update inputs; derived counter unchanged | 11-6 |
| 11.6 AC3 | Downgrade guard `PLAN_LIMIT_VIOLATION` vs derived count; passes after retiring rooms; wildcard force override works; tenant-side force ignored | 11-6 |
| 11.6 AC4 | Empty hotel shows onboarding copy ("No rooms yet") | 11-9 (UI) |
| 11.7 AC1 | Export columns/rows, filters respected, navy header, frozen row, auto-filter | 11-7 |
| 11.7 AC2 | Notes on all four header columns (EN + AR hotels, per `default_language`), `#`-marker explained | 11-7 |
| 11.7 AC3 | Dropdowns carry actual type names + status enum; 3 grey `#` example rows | 11-7 |
| 11.7 AC4 | Per-row preview errors; commit via shared bulk endpoint (`created`/`skipped`); plan limit applies to imports; untouched template = 3 skipped example rows | 11-7 (one AC4 failure = QA-11-001) |
| 11.7 AC5 | Non-xlsx rejected `IMPORT_FILE_INVALID`; leading zeros survive; whitespace trimmed; empty rows ignored; >1000 rows `IMPORT_TOO_MANY_ROWS` | 11-7 |
| 11.7 AC6 | `rooms.imported` + `rooms.exported` audit rows (count + source in metadata) | 11-7 (DB verification) |
| cross-tenant | Room detail/update/QR of another hotel → 404; lists never leak; same room number legal in two hotels; admin token rejected on tenant routes | 11-8 |

---

## Criteria NOT testable end-to-end (and why)

| AC | Reason |
|---|---|
| 11.4 AC1 — renumber **blocked** once a room has stay history | Stays ship in Epic 12/13. The spec's own decision log records that `hasStayHistory()` is currently a silent-allow stub; the blocked branch is untestable until stays exist. The no-history case (renumber allowed, collision 409) is covered. |
| 11.5 AC1/AC2 — print design bar (A4/A5 layout at print size, QR modules ≥2mm, multilingual scan lines, logo, "Powered by GXP" footer, cut guides) | Visual/print-quality properties of a rendered PDF need human (or image-analysis) review. The suite asserts valid non-trivial PDFs stream correctly and the QR payloads are exact; it cannot judge typography or print geometry. |
| 11.5 AC5 — deferred location-QR hook | Design-time requirement with no runtime surface in this epic. Indirectly supported by tests pinning the generic URL builder's output shape (`?room=`); the `?location=` shape has no endpoint yet. |
| 11.6 AC2 — field hidden from the Super Admin **edit form** | Admin-frontend UI is outside this suite's repo scope (backend + tenant dashboard + guest app). The API-level retirement (update ignores the manual field; guards read the derived counter) is covered in 11-6. |
| 11.2 AC2 — occupancy indicator placeholder | Explicitly "from Epic 12 onward" — nothing to assert yet. |
| 11.3 AC2 — "hotel chooses cancel" UI branch | Covered at API level (commit without `skipDuplicates` aborts atomically). The UI "cancel" click closes the preview modal and mutates nothing — low risk, not separately asserted. |
| Rate limiting on rooms endpoints | No rooms endpoint is rate-limited (by design). Login throttling constrains the harness itself; see Observations. |

---

## Notes for the next QA cycle

- Epic 12/13 (stays) will unlock: the renumber-block branch (11.4 AC1), occupancy placeholder (11.2 AC2), and `active-stay → out_of_service/inactive` 409 (11.4 AC2 "from Epic 12 onward"). Existing tests here seed rooms in a way those suites can reuse.
- The QA harness (`qa/`) is self-contained: `npm install && npx playwright install chromium && npx playwright test tests/epic-11` against a running dev stack. Requires `docker` for audit-row verification and cleanup; `GXP_LOGIN_PACING=off` skips throttle pacing only if the backend's limits are raised.
