# Epic 11 — Tenant Dashboard: Rooms Management & QR Codes

> **Scope:** Hotels manage their physical rooms in the Tenant Dashboard: room inventory (with bulk creation), room types, statuses, and — the star of this epic — **QR code generation with print-ready PDFs** (per-room cards + reception onboarding poster). Rooms become the platform's source of truth for room count (replacing the manual `rooms_count` field from Epic 05) and the anchor that Stays (Epic 12) and Guest Requests (Epic 13) attach to.
>
> **Guest URL contract (consumed by the Guest App later):**
> - Reception/banner QR → `GUEST_APP_BASE_URL/{slug}` (guest enters room number + stay code)
> - Room QR → `GUEST_APP_BASE_URL/{slug}?room={room_number}` (room pre-filled; guest enters stay code only)
> - An existing guest session always wins — a logged-in guest scanning any QR goes straight into the app; the `room` parameter is ignored. QRs are shortcuts, never identity.
>
> **Tenant permission catalog additions:**
> `rooms.read`, `rooms.create`, `rooms.update`
>
> Owner wildcard `*` covers all. (No `rooms.delete` — rooms deactivate, never hard-delete: they will carry stay/request history.)

---

## Story 11.1 — Room Types

**As a** hotel user with `rooms.update`,
**I want** to define my hotel's room types,
**so that** rooms are categorized the way my hotel actually sells them.

### Acceptance Criteria

- **AC1 — CRUD-lite:** Manage room types (name EN + AR, optional description EN + AR): create, edit, deactivate. Name unique per hotel per language.
- **AC2 — Seeded defaults:** New hotels get starter types (Standard, Deluxe, Suite — AR/EN), editable/deactivatable like any custom type (same philosophy as seeded roles, Epic 09).
- **AC3 — Guards:** A type with rooms assigned cannot be deactivated until rooms are reassigned (`409` with count — established pattern).

---

## Story 11.2 — Rooms List

**As a** hotel user with `rooms.read`,
**I want** to see all rooms with their status at a glance,
**so that** I know my inventory state.

### Acceptance Criteria

- **AC1 — Access control:** Rooms endpoints/nav require `rooms.read`; otherwise `403` / hidden.
- **AC2 — List:** room number, floor, type, status (`active` / `out_of_service` / `inactive`), and (from Epic 12 onward) current occupancy indicator placeholder. Filter by floor, type, status; search by room number; sensible default sort (floor, then natural number order — `101, 102, …, 110`, not `101, 110, 102`).
- **AC3 — Usage counter:** A header shows rooms used vs. plan limit (e.g., "84 / 100 rooms") with the >80% amber indicator (pattern from Epic 04, Story 4.6 AC3).

---

## Story 11.3 — Create Rooms (Single + Bulk)

**As a** hotel user with `rooms.create`,
**I want** to add rooms individually or as a bulk range,
**so that** setting up a 200-room hotel takes minutes, not a day.

### Acceptance Criteria

- **AC1 — Single:** room number (required; unique per hotel; alphanumeric to support "101A"), floor (optional int), type (from Story 11.1), status (default `active`).
- **AC2 — Bulk range:** floor + type + numeric range (e.g., 301–330) with optional exclusions (e.g., skip 313) → preview of the exact list before confirming. Duplicates against existing rooms are reported per-number in the preview; the hotel chooses "skip duplicates and create the rest" or cancels.
- **AC3 — Plan limit guard:** Creation (single or bulk) that would push countable rooms (`active` + `out_of_service`) above the plan's `max_rooms` returns `409` with details; bulk shows how many seats remain. Super Admin `force` override does **not** apply here (tenant-side action; the hotel upgrades the plan instead). `null` limit = unlimited.
- **AC4 — Atomic bulk:** A confirmed bulk creation is one transaction — all or nothing (after the preview already resolved duplicates).
- **AC5 — Audit:** `room.created` / `rooms.bulk_created` (with count + range).

---

## Story 11.4 — Edit Room & Status

**As a** hotel user with `rooms.update`,
**I want** to edit rooms and mark them out of service or inactive,
**so that** inventory reflects reality (renovations, closures).

### Acceptance Criteria

- **AC1 — Editable:** floor, type, status. Room **number** is editable only while the room has no stay history (it's printed on QR cards — the UI warns that renumbering invalidates any printed card for that room).
- **AC2 — Statuses:** `active` (sellable/usable) · `out_of_service` (temporary — maintenance/renovation; still counts toward plan limit) · `inactive` (long-term removed; does **not** count toward plan limit). From Epic 12 onward: a room with an active stay cannot be set `out_of_service`/`inactive` (`409`).
- **AC3 — Audit:** `room.updated` with diff.

---

## Story 11.5 — QR Codes & Print-Ready PDFs

**As a** hotel user with `rooms.read`,
**I want** to generate polished, print-ready QR materials from the dashboard,
**so that** I can hang the reception poster and place room cards without hiring a designer.

### Acceptance Criteria

- **AC1 — Reception poster:** One-click generation of an A4 (and A5) **onboarding poster** PDF: hotel logo + name, "Scan to access hotel services" in the hotel's guest-facing languages, the general QR (`/{slug}`), and a subtle "Powered by GXP" footer. Clean, premium design consistent with brand direction (this is client-visible product surface — Epic 08 design standards apply).
- **AC2 — Room cards:** Generation of **per-room QR cards** as a single PDF: selectable scope (all rooms / by floor / specific rooms), multiple cards per A4 sheet with cut guides, each card showing the room number + room QR (`?room={number}`) + short multilingual "Scan for room service & requests" line + hotel logo. Card size suited for bedside stands (roughly A6/half-A5).
- **AC3 — On-demand QRs:** Any room's QR (PNG/SVG) and its raw link are viewable/copyable from the room's detail view — for hotels that want to produce their own materials.
- **AC4 — Regeneration-safe:** QRs encode stable URLs derived from slug + room number — regenerating PDFs anytime yields identical codes (nothing stored, nothing to expire). Slug immutability (Epic 05) protects printed materials; the room-number edit warning (11.4 AC1) covers the room side.
- **AC5 — Deferred hook:** The generator's design must accommodate **location QRs** later (`?location=pool-bar` for beach/pool/lobby — F&B epic); no location entity is built now.

---

## Story 11.6 — Rooms Count Becomes Real (Platform Sync)

**As the** platform owner,
**I want** the plan's room limit to be enforced against actual rooms,
**so that** the manual `rooms_count` field stops being a parallel truth.

### Acceptance Criteria

- **AC1 — Derived count:** Everywhere the platform reads a hotel's room count (Super Admin hotel profile, subscription usage-vs-limits view from Story 4.6, downgrade guards from Story 4.7), the value is now **computed** from rooms (`active` + `out_of_service`).
- **AC2 — Manual field retired:** `hotels.rooms_count` from Epic 05 is deprecated: hidden from the Super Admin edit form, retained in DB as `declared_rooms_count` (renamed) for reference/sales context only — no guard reads it anymore. The Epic 05 edit guard (Story 5.4 AC3) is removed with it.
- **AC3 — Downgrade guard continuity:** Plan-change downgrade checks (Story 4.7 AC3) compare target `max_rooms` against the derived count — verified by tests.
- **AC4 — Empty state:** Hotels with zero rooms show onboarding-style prompts in the Tenant Dashboard ("Add your rooms to activate guest services") — rooms are the prerequisite for Epics 12–13.

---

## Story 11.7 — Excel Export & Annotated Import Template

**As a** hotel user with `rooms.create`,
**I want** to download an annotated Excel template, fill my rooms into it, and upload it — and export my current rooms anytime,
**so that** the room list my hotel already keeps in Excel becomes the setup, instead of retyping it.

### Acceptance Criteria

- **AC1 — Export (`rooms.read`):** One click downloads the current rooms as `.xlsx`: columns `Room Number | Floor | Type | Status`, one row per room, respecting active list filters. Header row styled (brand navy), frozen, auto-filtered.
- **AC2 — Annotated template (`rooms.create`):** A "Download template" action produces an `.xlsx` where **every input column carries an explanatory note** (cell comment on the header) stating: required/optional, format, and rules — e.g., Room Number: "Required. Unique per hotel. Letters/numbers allowed (e.g., 101, 101A)"; Floor: "Optional. Whole number"; Type: "Pick from the dropdown — manage types in Rooms → Types"; Status: "active or out_of_service". Notes are written in the hotel's `default_language` (AR or EN).
- **AC3 — Live dropdowns:** The Type column has Excel data-validation dropdowns populated with the hotel's **actual room types** (Story 11.1) at generation time; Status likewise. The template includes 2–3 greyed example rows marked clearly as examples (ignored on import).
- **AC4 — Import with preview:** Uploading a filled template runs the **same preview → commit flow as bulk creation** (Story 11.3): per-row validation results (row number + cell + translated error — duplicate number, unknown type, bad status, empty required), remaining plan seats, then "skip invalid rows and import the rest" or cancel. Commit is one transaction; the plan-limit guard (11.3 AC3) applies to the final count.
- **AC5 — Robust parsing:** Accepts `.xlsx` only (reject others with a clear message), tolerates the example rows and trailing empty rows, trims whitespace, treats room numbers as text (leading zeros like "007" survive), caps at 1,000 data rows per upload.
- **AC6 — Audit:** `rooms.imported` (row counts: created / skipped) and `rooms.exported`.

---

## Implementation Notes for Claude Code

Follow existing conventions (NestJS clean architecture; tenant guards + isolation from Epic 08 — every query scoped by `hotel_id`, cross-tenant = 404; tenant app i18n AR/EN; design system from Epic 08; brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **Entities:** `room_types` (`id, hotel_id, name_en, name_ar, description_en/ar, is_active`) and `rooms` (`id, hotel_id, room_number, floor, room_type_id, status`), with a unique index on (`hotel_id`, `room_number`). Natural-order sorting for room numbers (numeric-aware collation or app-side natural sort).
2. **Scope:** backend + tenant frontend, plus the small Super Admin touches from Story 11.6 (profile shows derived count; edit form drops the field). Migration renames `rooms_count` → `declared_rooms_count`.
3. **Bulk creation:** preview endpoint (validates range, returns per-number conflicts + remaining plan seats) separate from the commit endpoint (transactional). Cap range size sanely (e.g., 500/request).
4. **Plan-limit check** goes through the existing `TenantAccessService`/limits pattern (Epic 08 note 4) — count `active` + `out_of_service` in-transaction on create/status-change to avoid races (same discipline as the staff seat guard).
5. **QR generation:** server-side with a standard library (e.g., `qrcode`) — SVG/PNG endpoints per room + general. QRs are **derived, never stored**. Include error-correction level M+ so logo-overlay variants stay scannable if added later.
6. **PDF generation:** server-side. The project already uses Playwright/Chromium + Noto fonts for Arabic-correct PDFs (investor docs) — reuse that approach: HTML/CSS templates rendered to PDF gives full design control + RTL text support for the multilingual lines. Templates live in code beside the email templates philosophically: typed data in, file out. Stream the PDF as a download; don't persist generated files.
7. **Poster/card multilingual line:** for now render the scan-prompt line in a fixed set (AR, EN, RU, DE, FR — one short line each); when the Guest App localization epic lands, revisit. Keep the string set in one constant.
8. **Status/occupancy forward-compat:** design the rooms list item to accept an occupancy badge later (Epic 12) without layout rework; don't build occupancy now.
9. **Design bar (client-facing print!):** the poster and cards are physical brand artifacts guests will see — typography, spacing, and print margins matter. Test the PDF at actual print size; ensure QR modules ≥ 2mm at printed scale for reliable scanning.
10. **Excel export/import (Story 11.7):** use a server-side xlsx library that supports **header cell comments/notes and data-validation dropdowns** (e.g., `exceljs` — verify both features before committing to it). Template generation is per-hotel and on-demand (dropdowns reflect the hotel's current room types — never cache the file). Import parsing runs server-side; reuse the bulk preview/commit endpoints' validation logic — one validation source for range-bulk and Excel-bulk. Notes/labels come from the i18n files (AR/EN) keyed off the hotel's `default_language`. Stream both downloads; persist nothing.
11. **Guidance is part of this epic's definition of done (Epic 12 rule):** Epic 12's guidance kit (FieldHelp, InfoTip, PageIntro, HintCard, ConsequenceNote) ships **before** this epic — all Rooms pages must be built with it from the start (form helper texts with examples, status-badge InfoTips for `active`/`out_of_service`/`inactive`, designed empty states, plain-language confirmations with counts — "هيتم إنشاء 28 أوضة"), with all strings in the `guidance.*` namespaces (AR + EN). Additionally, extend the Epic 12 setup-steps block with the rooms steps ("add your rooms" → "print your QR codes"), auto-checking off from real data as designed there. There is no later retrofit for these pages — they arrive complete.
12. **Tests:** unique room numbers per hotel, bulk preview conflicts + atomic commit, plan-limit race, status transition guards, derived-count parity in downgrade guard (11.6 AC3), QR URL construction (slug + room param), natural sort, Excel round-trip (export → re-import as template = zero diffs), import edge cases (leading-zero numbers, example rows ignored, unknown type per-row error, row cap), plus component tests for the new pages' guidance elements (testing-library + jsdom now available). TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epics 08–10 (auth/guards, permissions, roles), Epic 04 (`max_rooms` limit), Epic 05 (slug + URL scheme, `declared_rooms_count` migration).
- **Blocks:** Epic 12 (Stays attach to rooms), Epic 13 (requests originate from rooms), future F&B (location QRs reuse the generator).
- **Deferred:** location entities + location QRs (F&B epic), room occupancy views (Epic 12), housekeeping room-status board (housekeeping epic), connected-room/villa groupings.
