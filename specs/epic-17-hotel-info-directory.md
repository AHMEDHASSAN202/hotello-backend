# Epic 17 — Hotel Info / Directory

> **Scope:** The digital replacement for the in-room paper compendium. The hotel manages guest-facing information in the Tenant Dashboard — WiFi access, facility hours, services, important contacts, house rules — and guests browse it in their language from a new **Hotel Info tile**. Cheap by design: it reuses the translation/fallback pattern, the storage driver for images, the module gating, and the guest app design system wholesale. No new backend concepts.
>
> **Content model philosophy:** structured sections with typed entries — NOT a free-form CMS. Structure is what makes 7-language fallback, consistent design, and fast hotel setup possible (same reasoning as the requests catalog).
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `hotel_info.manage`
> Seeded roles: Manager gets it; Front Desk gets it (they know the practical answers guests ask). Module key: `hotel_info` gates tile + routes + management page.

---

## Story 17.1 — Info Sections & Entries (Management)

**As a** hotel user with `hotel_info.manage`,
**I want** to fill structured info sections,
**so that** guests stop calling the desk for the WiFi password.

### Acceptance Criteria

- **AC1 — Fixed section types (platform-defined, hotel-filled):**
  - **Essentials:** WiFi network + password (rendered copy-tappable for guests), reception phone/WhatsApp number, emergency contact, checkout time (auto-pulled from the Epic 13 setting — read-only here).
  - **Facilities:** repeatable entries — name, description, opening hours (multiple windows, same time-window component as menus), optional photo, optional location note ("Building B, floor 2").
  - **Services:** repeatable entries — name, description, how to get it (free text), optional price note.
  - **House rules / Good to know:** repeatable short entries (quiet hours, pool towels policy, smoking policy…).
  - **About the hotel:** one rich-ish text block (paragraphs only — no arbitrary HTML) + optional photo gallery (up to 8, storage-driver uploads, auto-resized like F&B photos).
- **AC2 — Translations:** all hotel-entered text follows the established rule: AR + EN required, other 5 optional with EN fallback (same JSONB + fallback function as menus/custom items).
- **AC3 — Curation:** entries reorder within sections; sections with zero entries auto-hide from guests; per-entry active toggle. Platform section types are fixed (no custom sections in MVP).
- **AC4 — Guidance DoD:** the management page ships with full guidance copy — including a HintCard noting that WiFi + facility hours answer 80% of desk questions (nudges the right first fills).
- **AC5 — Audit:** `hotel_info.updated` with diffs.

---

## Story 17.2 — Guest: Hotel Info Tile

**As a** guest,
**I want** the hotel's practical info in my language in two taps,
**so that** I never hunt for a paper folder or queue at the desk to ask.

### Acceptance Criteria

- **AC1 — Tile activation:** the Hotel Info tile goes live (module `hotel_info`, config flip). Bottom nav position per the established order.
- **AC2 — Layout:** sections render in the fixed order (Essentials pinned first) as clean cards; WiFi password gets a **tap-to-copy** affordance with a copied-feedback beat; phone numbers are tap-to-call links; facility cards show an **"Open now / Opens at 16:00"** live badge computed from the hours (hotel-local time — reuse the availability helpers).
- **AC3 — Language:** everything in the guest's language with EN fallback per entry; the seven-locale parity check covers all new UI strings.
- **AC4 — States:** module disabled → tile back to "soon"; zero content → tile hidden entirely (an empty directory is worse than none); photos lazy-load within the bundle budget (this tile must not push the app over — dynamic chunk like dining if needed).
- **AC5 — Design bar:** inherits Epic 14 fully — this screen is guests' most-opened reference page; the Essentials card specifically gets the pixel-polish treatment.

---

## Implementation Notes for Claude Code

1. **Entities:** `hotel_info_entries` (`hotel_id, section_type enum, translations JSONB, structured fields JSONB per type — hours windows, phone, price_note, photo keys…, sort, is_active`). One table, typed by section — don't over-normalize five section types into five tables. Migration in-PR.
2. **Guest endpoint:** `GET /guest/hotel-info` — language-resolved server-side, active entries only, sections ordered, computed "open now" left to the client (client has the hours + the established local-time helpers) to keep the response cacheable (60s cache like the profile endpoint).
3. **WiFi password handling:** it's guest-facing by nature — no special secrecy, but never log it and exclude it from audit diffs (log "wifi updated" without values).
4. **Checkout-time entry** is a projection of the Epic 13 setting — render it in Essentials server-side; no duplicate storage.
5. **Reuse inventory:** time-window component + availability helpers (16.2), photo upload/resize pipeline (16.2), translations fallback (15/16), tile config (14), copy-to-clipboard affordance (from the temp-password pattern, guest-styled).
6. **Tests:** fallback rendering per entry, open-now boundaries (overnight windows), empty-section hiding, module gating both surfaces, seven-locale parity, copy affordance component test. Device design pass on the guest tile per the standing 14.5 AC6 bar. Builds clean.

---

## Decisions (recorded during implementation — durable)

1. **Content model:** one `HotelInfoEntry` entity with `names`/`descriptions` TranslationMap columns, a per-section `structured` JSONB (essentials wifi/phones; facility `windows` + `locationNote`; service `howTo` + `priceNote`) and a dedicated `photos: {id, thumb, detail}[]` column. Per-section photo caps: facilities **1**, about **8**, others 0 (`HOTEL_INFO_MAX_PHOTOS`).
2. **Singletons:** `essentials` and `about` are one row per hotel via `PUT /tenant/hotel-info/essentials|about` with full-replacement semantics; an all-empty upsert deletes the row. Repeatable sections get POST/PATCH + `POST sections/:section/reorder` + `isActive` — **no DELETE endpoint** (matches F&B items and AC3).
3. **Essentials fields** are plain strings (max 80/40), no phone-format enforcement; the guest app renders `tel:` links (WhatsApp renders a `wa.me` link). Checkout time is never stored — projected from `hotel.checkoutTime` on both surfaces.
4. **Translations:** entry names AR+EN required (`HOTEL_INFO_NAMES_REQUIRED`, reusing `mergeNames` with a code param); descriptions and aux fields (locationNote/howTo/priceNote) accept any locale subset with EN fallback. About text = the singleton's `descriptions` (≤4000/locale, paragraphs split on blank lines, no HTML).
5. **Audit:** single action `hotel_info.updated` on entityType `hotel_info_entry` with the standard diff idiom; the WiFi password diff is `{ changed: true }` — values never logged (spec note 3).
6. **Guest cache:** TTL-only in-process Map keyed `hotelId:language`, `HOTEL_INFO_CACHE_TTL_MS` (default 60s) — same mechanism as the profile endpoint, no invalidation hooks.
7. **Tile tri-state (17.2 AC1/AC4):** module disabled → tile visible as "soon"; enabled + zero active entries → tile hidden entirely; enabled + content → live. Signal: public profile gained `hotelInfoHasContent` (computed inside the cached profile). Bottom-nav info slot appears only when live.
8. **Open-now** is computed client-side (`src/lib/hours.ts`, ported from `fnb-availability.ts`/`stay-time.ts`), refreshed on a 30s tick; windows reuse the F&B shape (max 4, `start > end` = overnight, `[]` = always, no weekday dimension).
9. **Photos:** same renditions as F&B (480×360 thumb / ≤1200 detail, WebP), keys `hotel-info/{hotelId}/{entryId}/{uuid}-*.webp`; `files` controller serves the `hotel-info/` prefix with the year-long immutable cache. Errors: `HOTEL_INFO_PHOTO_INVALID` (400), `HOTEL_INFO_PHOTOS_FULL` (409 `{max, count}`).
10. **Module enablement:** `HotelInfoFoundation` migration appends `hotel_info` to every existing plan's `enabledModules` (super admins can remove it per plan) and grants `hotel_info.manage` to existing Manager + Front Desk roles.
11. **Shared editors extracted (hotel FE):** `HoursEditor` and `PhotoPicker` lifted out of the F&B modals; `NameFields` gained a `namespace` prop. `TENANT_HINT_KEYS` also gained the three missing Epic 16 keys (`fnb.firstRun`, `fnb.locationsGuidance`, `fnb.soundMuted`) alongside `hotelInfo.firstRun` — their dismissals were silently 400ing.

## Notes & Dependencies

- **Depends on:** Epics 14–16 machinery only. Independent of 18–22 — safe to implement immediately.
- **Feeds:** Announcements (Epic 19) will deep-link to info entries ("البسين هيقفل بكرة للصيانة — التفاصيل في معلومات الفندق"); Events (Epic 21) sits beside facilities naturally.
- **Deferred:** custom sections, PDF export of the directory, per-entry QR ("scan for spa info"), maps integration.
