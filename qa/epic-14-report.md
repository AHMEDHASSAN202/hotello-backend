# QA Report — Epic 14: Guest App Foundation (PWA)

- **Suite:** `hotello-backend/qa/tests/epic-14/` (Playwright, 5 spec files, 30 tests)
- **Surfaces under test:** hotello-guest-frontend (`:3002`, real browser), hotello-backend public guest endpoints, hotello-hotel-frontend (none — tenant-side only via setup)
- **Stack:** local dev stack (API :4000, tenant :3001, guest :3002), migrations + seed applied
- **Result: 30 passed / 0 failed.** One product-level data finding (QA-14-001, minor) plus observations.
- **Isolation model:** guest-session UI tests use dedicated per-run hotels (rate-limit budget + localStorage is per-origin across all slugs); PWA/profile tests provision fresh hotels so the profile endpoint's 60s per-slug cache never masks state changes.

---

## Findings

### QA-14-001 — Newly added module keys never reach existing plans (seeded Standard predates `requests`)

- **ID:** QA-14-001
- **Severity:** minor (data/migration gap — one backfill fixes it; impact below)
- **Acceptance criterion touched:** 14.4 AC3 — "Tiles are config-driven so Epic 15 activates Requests by flipping a flag, and plan `enabled_modules` gates tiles per hotel from day one", together with the recorded decision "`requests` module key added to `MODULE_CATALOG` … so plan gating of the Requests tile works from day one."
- **Steps to reproduce:**
  1. Inspect any hotel subscribed to the **seeded "Standard" plan** (e.g. `GET /api/v1/guest/demo-hotel/profile`).
  2. Observe `enabledModules`: `["transportation","housekeeping","fnb","analytics","hotel_info","announcements","events"]` — **`requests` is missing**.
  3. Open the Guest App home for such a hotel: the Requests tile does not render (`visibleTiles` drops it because the module is not in the plan).
- **Expected vs actual:**
  - **Expected:** adding `requests` to `MODULE_CATALOG` (Epic 14) should surface the Requests tile for hotels on the Standard plan — the seed created that plan with "all modules, no limits".
  - **Actual:** `ALL_MODULE_KEYS` grew when `requests` (and `guest_app_branding`, `events`) joined the catalog, but the **existing** Standard/Free Trial plan rows were seeded find-or-create style and never backfilled. Every hotel on a pre-Epic-14 plan lacks the new keys — the "flip a flag" activation cannot reach them.
- **Failing test:** none fails outright — `qa/tests/epic-14/14-4-home.spec.ts` › `14.4 AC3 — services grid: live tiles, "Soon" tile, gating follows enabled_modules` documents the correct gating behavior on **freshly created** plans (which do include `requests`) and is the test that exposed the gap.
- **Repo/area (best guess, no fix applied):** hotello-backend — `src/database/seeds/seed.ts` (find-or-create plans never refresh `enabled_modules`) / a backfill migration. Newly created plans behave correctly (verified).
- **Why not a test bug:** verified outside the suite — `GET /guest/demo-hotel/profile` (a hotel that predates Epic 14) shows the stale module list, while freshly created plans include every current catalog key.

### Observations (no AC violated)

1. **Guest profile cache (60s/slug) is observable.** `GET /guest/{slug}/profile` caches per slug (`GUEST_PROFILE_CACHE_TTL_MS`), so state changes (plan change, accent color, suspension) take up to a minute to appear. The suite provisions fresh hotels per scenario instead of mutating mid-test. Per the spec this caching is deliberate ("public, cached") — noted so future branding work doesn't mistake it for a bug.
2. **Service worker registration is dev-skipped by design** (`SwRegister` returns early unless `NODE_ENV=production`). The suite therefore verifies the `/sw.js` and `/offline.html` assets are served and wired; the live offline-shell flow is production-build territory (see "not testable").
3. **TenantAccessService 10s state cache** means suspension/trial-expiry takes up to ~10s to reach the guest profile — the suite waits out the window. Consistent with the documented short-cache discipline.
4. Guest JWTs minted in the same second are byte-identical (second-granularity `iat`) — covered in the Epic 13 report; multi-device validity is asserted instead of token inequality.

---

## Coverage matrix (AC → tests)

| AC | What was tested | Where |
|---|---|---|
| 14.1 AC1 | `/{slug}` resolves and renders; (desktop phone-width layout is a CSS/layout property — spot-checked via the app frame; full visual review belongs to 14.5 AC6) | 14-2/14-5 (UI) |
| 14.1 AC2 | `/{slug}/manifest.webmanifest` served per hotel with the **hotel's name**, `display: standalone`, icons; `viewport-fit=cover` + `theme-color` meta present | 14-1 |
| 14.1 AC3 | `/sw.js` and `/offline.html` served; registration production-only (see observations) | 14-1 |
| 14.1 AC4 | JS-payload tripwire on the entry page (< 1.5MB across `_next/static` JS chunks); enforced Lighthouse budgets are pipeline territory — see "not testable" | 14-4 |
| 14.1 AC5 | Unknown slug → branded "Hotel not found" (guest copy); suspended → guest-unavailable screen; expired trial (subscription flipped to `expired` exactly as the trial-expiry job writes it) → same screen; no internal vocabulary on-screen | 14-1 (API), 14-5 (UI) |
| 14.2 AC1 | `/{slug}` shows room + code inputs; `?room=304` locks the room as a chip (no editable room field) with code-only entry; existing session boots straight home, URL params ignored | 14-2 |
| 14.2 AC2 | Segmented code input: numeric entry, auto-submit on the 6th digit, paste-friendly (clipboard paste enters the app), `inputmode`/one-time-code semantics | 14-2 |
| 14.2 AC3 | Wrong code → inline "The code doesn't match…" without navigation, room field intact | 14-2 |
| 14.2 AC4 | Session persistence: reload with a stored token boots straight home; boot-401 (stale token after checkout) routes **silently** to entry — no goodbye flash, no error copy | 14-2, 14-5 |
| 14.2 AC5 | Mid-use session death (checkout while the app is open) → warm goodbye ("This stay has ended — we hope you enjoyed your visit!") with the entry form beneath | 14-2 |
| 14.2 AC6 | The same code opens two independent browser contexts, both land in-app | 14-2 |
| 14.3 AC1 | The guest repo's seven-locale parity check (`npm run check:i18n`) passes, executed from inside the suite | 14-3 |
| 14.3 AC2 | Browser language (`locale: ru-RU`) picks the entry language; the stay's guest language drives the home screen (ar guest → Arabic + RTL) | 14-3 |
| 14.3 AC3 | Switcher reachable in-app; switching to Русский flips the home copy instantly (no reload) | 14-3 |
| 14.3 AC4 | Arabic stay → `<html dir="rtl">`, Arabic stay-card copy | 14-3 |
| 14.3 AC6 | Russian ICU plurals on the stay card ("Осталось 3 ночи"), localized checkout date («до пт, 4 сент.»), hotel checkout time shown | 14-3 |
| 14.4 AC1 | Public profile endpoint: guest-safe fields only (slug, nameEn/Ar, logoUrl, status, checkoutTime, timezone, defaultLanguage, enabledModules), unknown slug → 404 `HOTEL_NOT_FOUND`, suspended/expired collapse to `status: 'unavailable'` | 14-1 |
| 14.4 AC2 | Home composition: "Welcome, {name}!", stay card (room, nights remaining, "until {date} · 12:00"), services grid | 14-4 |
| 14.4 AC3 | Live tiles (Requests/Dining/Events), Transport as "Soon"; gating hides tiles for modules not in the plan; Hotel Info tri-state (module on + no content → hidden) | 14-4 (see QA-14-001 for the seeded-plan gap) |
| 14.4 AC4 | Checkout-day note: stay ending today shows "Checkout today at 12:00 — we hope you enjoyed your stay" | 14-4 |
| 14.4 AC5 | Accent gating server-side: `brandAccentColor` reaches the app only when the plan includes `guest_app_branding` (fresh-slug proof both ways) | 14-1 |
| 14.5 AC1/AC3 | App-feel spot checks: chrome text not user-selectable, `overscroll-behavior-y` tuned, entry controls ≥ 44px (room input, code boxes, language pill), nav-present shell | 14-5 |
| 14.6 AC1/AC2 | State screens: not-found, unavailable (suspended), rate-limited with live MM:SS countdown (`role="timer"`), warm goodbye (14-2), offline assets; tone rule — no "suspended/subscription/trial/tenant/401" anywhere guest-facing | 14-5, 14-1 |

---

## Criteria NOT testable end-to-end (and why)

| AC | Reason |
|---|---|
| 14.1 AC3 — live offline-shell flow | The service worker is deliberately **not registered in dev** (stale-cache protection). Assets (`/sw.js`, `/offline.html`) are verified served; the offline screen itself needs a production build (or a `next start` run) — recommended as a staging check. |
| 14.1 AC4 — enforced Lighthouse budgets (LCP < 2.5s, TTI < 3.5s, throttled mobile) | Requires the Lighthouse CI pipeline; the suite ships a JS-weight tripwire only. Budget enforcement belongs to the repo's CI per implementation note 7. |
| 14.3 AC5 — font subsetting per script, `font-display: swap`, no FOIT | Font-pipeline properties (preload headers, subset files) are build-output details; not assertable meaningfully through the DOM. |
| 14.5 AC2 — motion specifics (200–300ms eased transitions, drag-to-dismiss physics, reduced-motion behavior) | Timing/physics qualities need interaction-level review; the suite verifies the structural pieces (bottom-sheet switcher, skeletons via loading states). |
| 14.5 AC6 — design review gate on real Android + iPhone (RTL, ru, de) | Explicitly a human review gate in the spec — cannot be automated. |

---

## Harness notes for future epics

- `qa/helpers/guest-ui.ts` provides `guestSessionOk` (public contract), `uiGuestSession` (localStorage/cookie seeding that mirrors `lib/auth.ts`), and the guest app base URL. Epic 15 (requests) enters the app exactly this way.
- The guest app serves every hotel from ONE origin — `localStorage` is shared across slugs; always use fresh browser contexts per test (the `page` fixture already does).
- The seeded Standard/Free Trial plans carry a stale `enabled_modules` array (QA-14-001). Any suite asserting module-gated behavior must create plans explicitly via `createPlan`.
