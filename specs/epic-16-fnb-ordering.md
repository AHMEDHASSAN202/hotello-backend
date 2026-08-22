# Epic 16 — F&B Ordering (End to End)

> **Scope:** The revenue engine. Hotels build photo menus; guests browse in their language, build a cart, and order to their **room or to a hotel-defined location** (pool, beach — with optional spot numbers and location QR stickers); the kitchen works orders on a live board. Includes **stay types** (the All-Inclusive pricing model — a small Epic 13 extension), the hotel's **payment-methods configuration** (cash / room charge, no online payment), and room-charge visibility at checkout.
>
> **Pricing model (the market differentiator):** every item is either **always paid** or **included for specific stay types**. An All-Inclusive guest sees included items with an ✓Included mark (no price) and paid items (imported drinks, specialty menus) with prices — in one seamless menu. Nobody selling into the Egyptian resort market does this properly.
>
> **Patterns reused wholesale (don't reinvent):** catalog-with-fallback translations, delta-polling live board + sound + SLA + overdue float (Epic 15), bulk-series generation + printable QR PDFs (Epic 11), storage-driver photos (Epic 05), guest-app design system/motion/7-locale i18n (Epic 14).
>
> **Tenant permission catalog additions:** `fnb_menus.manage`, `fnb_locations.manage`, `fnb_orders.read`, `fnb_orders.update`, `fnb_settings.manage`
> Seeded roles: Manager gets all; **new seeded role "F&B / Kitchen"** (AR: «الأغذية والمشروبات») gets `fnb_orders.read/update` + `fnb_menus.manage`; Front Desk gets `fnb_orders.read`. Module key: `fnb` gates everything (tile, routes, board).

---

## Story 16.1 — Stay Types (Epic 13 Extension)

**As a** front desk user,
**I want** to record the guest's board basis at check-in,
**so that** their menu prices itself correctly.

### Acceptance Criteria

- **AC1 — Enum:** `stay_type` on stays: `all_inclusive`, `half_board`, `bed_breakfast`, `room_only`. Check-in form gains the field (with guidance); editable later via stay edit (audit in the diff).
- **AC2 — Hotel default:** a "default stay type" setting (in the Epic 13 stay-settings card) pre-selects it at check-in — resorts set All-Inclusive, city hotels Room Only.
- **AC3 — Backfill:** existing active stays get the hotel's default via migration (noted in the report).
- **AC4 — Session exposure:** the guest session profile now includes `stayType` — the Guest App prices menus from it without extra calls.

---

## Story 16.2 — Menus & Items Management

**As a** hotel user with `fnb_menus.manage`,
**I want** to build photo menus with availability and smart pricing,
**so that** my F&B operation is fully represented.

### Acceptance Criteria

- **AC1 — Menus:** multiple menus (In-Room Dining, Pool Bar, Breakfast…): name/description AR + EN required, other 5 languages optional with EN fallback (the Epic 15 custom-item pattern — same fallback function), **availability windows** (start–end time, hotel-local; multiple windows allowed; overnight windows like 20:00–02:00 handled), active flag, sort order, and a **prep-time SLA target** (minutes) per menu.
- **AC2 — Sections & items:** items live in sections within a menu (Starters, Mains, Drinks — bilingual section names). Item: name/desc (same language rules), **photo** (required-strongly-encouraged: upload via the storage driver, sensible crop/resize; a tasteful placeholder if absent), price (hotel currency), active, sort.
- **AC3 — Pricing mode per item:** `always_paid` (default) **or** `included_for: [stay types]`. A menu-level default can mark everything included-for-AI at once, with per-item override (e.g., the Pool Bar menu defaults included-for-All-Inclusive, but "Imported Whiskey" overrides to always-paid). This satisfies the confirmed decision: some menus/drinks are always paid for every stay type.
- **AC4 — One simple variant:** optional single variant group per item: label ("Size") + options each with its own absolute price ("Medium 80 / Large 110"). Included items may still carry variants (price shows only when the guest's stay type doesn't cover them). No multi-group modifier builder.
- **AC5 — Free note:** items accept guest notes at order time by default; per-item toggle to disable.
- **AC6 — Guards & audit:** deactivating a menu/section/item never touches existing orders (snapshot rule); `fnb_menu.updated` audits with diffs.

---

## Story 16.3 — Delivery Locations & QR Stickers

**As a** hotel user with `fnb_locations.manage`,
**I want** to define where guests can receive orders and print QRs for those places,
**so that** the beach and pool become revenue surfaces.

### Acceptance Criteria

- **AC1 — Locations:** hotel-defined delivery locations (name AR + EN, active, sort): Pool, Beach A, Lobby… Each location has a toggle **"has numbered spots"** + a spot label (Umbrella / Table / شمسية). "My room" is always implicitly available and is not a managed location.
- **AC2 — Location QRs:** each location gets a QR (`/{slug}?location={key}`) viewable/copyable, plus **printable sticker PDFs** from the Epic 11 generator: single stickers and a **numbered series** ("Pool, spots 1–40" → 40 stickers, each `?location=pool&spot=12`) using the bulk-range + preview machinery. Sticker design matches the room-card quality bar.
- **AC3 — Operational guidance (in-product):** the locations page guidance explains the recommendation: zone stickers for everything; numbered-series stickers **only for fixed furniture** (mounted umbrellas, tables) — movable sunbeds should use the zone sticker + guest-typed spot number, because furniture moves and a wrong pre-filled spot is worse than none.
- **AC4 — Stability:** location keys are immutable once created (printed QRs depend on them) — rename changes display names only; deactivating hides from guests but keeps QRs resolving to a graceful "choose your location" fallback.

---

## Story 16.4 — F&B Settings (Payment Methods)

**As a** hotel user with `fnb_settings.manage`,
**I want** to configure how guests can pay,
**so that** the app matches my actual operation.

### Acceptance Criteria

- **AC1 — Methods config:** hotel chooses: **cash on delivery only**, or **cash + room charge** (pay at checkout). At least one always on; room charge is opt-in. (Online payment intentionally absent — future epic.)
- **AC2 — Guest effect:** the order sheet shows only enabled methods; with one method it's preselected and compact. Copy is honest: "Pay the waiter on delivery" / "Add to my room bill — pay at checkout", translated ×7.
- **AC3 — Fully-included orders:** an order whose lines are all ✓Included skips payment selection entirely (total 0) — the most common All-Inclusive case stays frictionless.

---

## Story 16.5 — Guest: Browse, Cart & Order

**As a** guest,
**I want** to order food like on a delivery app,
**so that** spending money at the hotel is the easiest thing I do today.

### Acceptance Criteria

- **AC1 — Tile & browse:** the Dining tile activates (module `fnb`). Menus show with availability awareness — an unavailable menu is visible but marked ("Breakfast · 7:00–11:00 · opens in 2h", tappable to browse, not orderable). Items render with photos, prices **or ✓Included** per the guest's `stayType`, in the guest's language (EN fallback).
- **AC2 — Item sheet:** photo, description, variant selector (prices per option or ✓Included), quantity stepper, note field (if enabled), add-to-cart with price/included feedback. Epic 14 motion standards throughout.
- **AC3 — Cart:** persistent per stay (survives app restarts until ordered/cleared), line editing, **totals show paid amount only** with included lines listed at 0 + ✓ badge, mixed carts fine. Cart cannot mix items from menus with disjoint current availability (edge: menu closed while in cart → line flagged, must remove).
- **AC4 — Checkout sheet:** delivery destination — **"My room (304)" default**, or a location (from 16.3; pre-selected by `?location` QR param, spot pre-filled by `?spot`, both editable), spot number input when the location has spots (guest-typed if not pre-filled); payment method per 16.4; place order → optimistic success animation → tracking screen. Order snapshot: names ×7? — snapshot the guest-language + AR + EN names, prices, included flags.
- **AC5 — Throttles:** open-orders + daily caps (env-tunable, defaults generous), duplicate-tap protection — same discipline as requests.
- **AC6 — QR param handling:** `?location`/`?spot` behave exactly like `?room` in the contract: pre-fill only, dropped once used, never trusted as identity, session always wins.

---

## Story 16.6 — Guest: Order Tracking

**As a** guest,
**I want** to watch my order progress,
**so that** I never wonder if the kitchen got it.

### Acceptance Criteria

- **AC1 — Statuses:** `new` (Received) → `preparing` → `on_the_way` → `delivered`; plus `cancelled`. Delta-polled like requests; transitions animate; the active order shows as a compact progress card on the app home too.
- **AC2 — Detail:** lines with photos, destination ("Pool · Umbrella 12"), payment method + amount to have ready (cash) / "on your room bill", timeline with times, guest cancel while `new` only.
- **AC3 — History:** the stay's past orders with totals; room-charge orders visibly badged (feeds the guest's own expectation of the checkout bill).

---

## Story 16.7 — Kitchen Board & Lifecycle

**As an** F&B user with `fnb_orders.read`/`update`,
**I want** a live kitchen board,
**so that** orders flow from screen to tray without a printer.

### Acceptance Criteria

- **AC1 — Board:** mirrors the requests board (delta polling ~10s, sound toggle, badge, overdue float) with F&B card anatomy: lines (qty × item, variant, note with language tag), **destination prominent** ("البسين — شمسية 12" / "أوضة 304"), payment chip (**"كاش: 230 ج.م"** / "على حساب الأوضة" / "✓ مشمول"), guest name + room, age vs the menu's prep SLA.
- **AC2 — Transitions:** Start (→ `preparing`), Out for delivery (→ `on_the_way`), Delivered (→ `delivered`); staff cancel with reason (out of stock / kitchen closed / guest request / other+note) from `new`/`preparing`. Assignment optional (same pattern/permission model as requests — `fnb_orders.update` acts, assign uses the same options-endpoint pattern).
- **AC3 — Filters & stats-lite:** status, menu, destination zone, assignee, overdue. Header: today's orders / delivered / **paid revenue today** (delivered paid totals) — the number that sells the module to owners.
- **AC4 — Audit:** `fnb_order.started/out_for_delivery/delivered/cancelled/assigned`.

---

## Story 16.8 — Room Charge at Checkout (Visibility, Not Folio)

**As a** front desk user,
**I want** unpaid room charges surfaced at checkout,
**so that** no order leaves unpaid — without building a billing system.

### Acceptance Criteria

- **AC1 — Stay detail:** the stay drawer lists its orders with payment method; room-charge delivered orders sum into an **"Unsettled room charges: 460 ج.م"** line.
- **AC2 — Checkout interlock:** manual checkout's ConsequenceNote includes the unsettled sum ("سيتم إنهاء الإقامة — يوجد 460 ج.م مشتريات على حساب الغرفة لم تُحصَّل") with a "mark as settled" confirmation step (bulk, audit `fnb_orders.settled`). Auto-checkout doesn't block — unsettled charges stay visible in stay history flagged for follow-up.
- **AC3 — Explicit non-goals:** no invoices, taxes, discounts, or PMS folio posting — prices are as-entered; a proper billing/folio module (and PMS posting) is future work, stated in guidance.

---

## Implementation Notes for Claude Code

1. **Entities:** `fnb_menus`, `fnb_menu_sections`, `fnb_items` (JSONB translations per Epic 15 pattern; photo storage key; pricing mode: `included_for` stay-type array, empty = always paid; variant JSONB), `fnb_locations` (immutable `key`, spots toggle+label), `fnb_orders` + `fnb_order_lines` (full snapshots incl. included-flags and unit prices at order time), `fnb_settings` embedded on hotels or a small settings table (payment methods, defaults). Migrations in-PR as law; seeds: the F&B/Kitchen role + permissions backfill (Manager/Front Desk per header).
2. **Availability math is hotel-local:** reuse the Epic 13 `Intl` wall-clock helpers for windows incl. overnight spans; server is the authority (an order into a just-closed menu → `MENU_UNAVAILABLE` 409, client refreshes gracefully).
3. **Pricing resolution in ONE function:** `(item, variantOption, stayType) → {included: bool, unitPrice}` — used by guest render, cart totals, and order creation (server recomputes; client totals are display-only). Test matrix across all four stay types × always-paid/included × variants.
4. **Guest endpoints** extend `/api/guest`: `GET fnb/menus` (language-resolved, availability-annotated), `POST fnb/orders`, `GET fnb/orders(+/:id)`, `POST fnb/orders/:id/cancel`. Same guards, throttles server-side, stay from JWT only.
5. **Board reuse:** extract/share the delta-polling board core from Epic 15 (poller, sound, badge, overdue float) rather than duplicating — one board engine, two configurations. Same for the guest polling hook.
6. **Photos:** storage-driver uploads with server-side resize to two sizes (list thumb / detail), long-cache public URLs via the established pattern; menus render acceptably photo-less (placeholder) so the demo hotel isn't blocked on photography.
7. **PDF stickers:** extend the Epic 11 generator with the sticker template (single + numbered series w/ preview); location `key` + optional `spot` in the QR URL; same print-quality bar (test at size).
8. **Currency display:** hotel currency formatted per locale (Latin digits, "230 ج.م" / "EGP 230" placement per language) — one formatter, used everywhere including the board.
9. **Cart storage:** client-persisted per stay (keyed by stay id, cleared on stay death) — no server cart in MVP; the order POST is the source of truth.
10. **Tests:** pricing matrix, availability windows (overnight + boundary), snapshot immutability under menu edits, throttles, transition matrix + guest-cancel window, settlement flow + auto-checkout non-blocking, location key immutability, `?location/?spot` prefill-only contract, seven-locale parity, board delta correctness. Device design pass (14.5 AC6 standard) on browse/cart/checkout — **this flow is the demo.**

---

## Notes & Dependencies

- **Depends on:** Epics 13–15 merged (stays, guest app foundation, requests patterns), Epic 11 (PDF generator), Epic 04 module gating (`fnb`).
- **Blocks / feeds:** analytics (revenue data starts now), Staff Task PWA (delivery runners), future billing/folio + PMS posting, AI menu-translation fast-follow.
- **Deferred:** online payment, AI translation button, multi-group modifiers, scheduled orders, printers/KDS hardware integration, service charge/VAT breakdown, guest tipping.

---

## Implementation decisions (2026-08-22)

Durable decisions made while implementing (backend landed on master):

1. **Photo resize** — `sharp` added; two derived WebP renditions at upload (thumb 480×360 cover q80, detail ≤1200 inside q82) under immutable keys `fnb/{hotelId}/{itemId}/{uuid}-{thumb|detail}.webp`; the `files` controller serves `fnb/`-prefixed keys with `Cache-Control: public, max-age=31536000, immutable`. Originals are not kept.
2. **Duplicate-tap protection** — client-side in-flight disable only (matches the Epic 15 recorded decision); no server idempotency keys.
3. **Board `overdue` filter** — implemented server-side for F&B (`dueAt < now` on open statuses), unlike the dead param on the requests board.
4. **Settings storage** — columns on `hotels`: `defaultStayType` (default `room_only`) and `fnbRoomChargeEnabled` (default false). Cash is always on; room charge is the only toggle (16.4 AC1). No settings table until online payment exists.
5. **Pricing-mode encoding** — `fnb_items.includedFor`: `null` = inherit the menu's `defaultIncludedFor`; `[]` = always paid (override); non-empty = included for those stay types. Menu default `[]`.
6. **Order snapshots** — lines snapshot names as `{ar, en, guestLanguage}` subsets plus variant label/option names, unitPrice, included flag, photo thumb key; orders snapshot room, guest, language, stay type, currency, location key+names, `menuIds` (board menu filter), SLA = max prep SLA of involved menus.
7. **Settlement permission** — `POST /tenant/fnb-orders/stay/:stayId/settle` is guarded by **`stays.checkout`** (front-desk checkout action; seeded Front Desk has no `fnb_orders.update`). Settlement is bulk + idempotent, audited once as `fnb_orders.settled`.
8. **Assignment permission** — no `fnb_orders.assign`; assigning is part of `fnb_orders.update`, options endpoint filters roles granting that key (or `*`).
9. **Multi-menu carts** — allowed; every involved menu must be open at POST time (`409 MENU_UNAVAILABLE {menuId}`); order SLA is the max involved `prepSlaMinutes`.
10. **Currency exposure** — `hotels.currency` added to the guest public profile and `/tenant/me` hotel block; `GuestProfile` gained `stayType` + `stayId` (cart key).
11. **Fully-included orders** — `paymentMethod` stored as `null`; a method sent by the client is ignored.
12. **Guest cancel** — `new` only; staff cancel from `new`/`preparing`; `on_the_way` can only be delivered.
13. **Throttles** — env `GUEST_FNB_MAX_OPEN_PER_STAY` (default 5) / `GUEST_FNB_MAX_PER_DAY` (default 20); 429 codes `FNB_LIMIT_OPEN` / `FNB_LIMIT_DAILY`.
14. **Error codes** — `FNB_MENU_NOT_FOUND`, `FNB_SECTION_NOT_FOUND`, `FNB_ITEM_NOT_FOUND`, `FNB_ITEM_DISABLED`, `FNB_NAMES_REQUIRED`, `FNB_PHOTO_INVALID`, `FNB_VARIANT_INVALID`, `FNB_LOCATION_NOT_FOUND`, `FNB_LOCATION_INVALID`, `FNB_LOCATION_NO_SPOTS`, `FNB_STICKER_RANGE_INVALID`, `MENU_UNAVAILABLE`, `FNB_ORDER_NOT_FOUND`, `FNB_ORDER_INVALID_STATUS`, `FNB_ASSIGNEE_INVALID`, `FNB_PAYMENT_METHOD_INVALID`, `FNB_NOTE_NOT_ALLOWED`, `FNB_LIMIT_OPEN`, `FNB_LIMIT_DAILY`.
