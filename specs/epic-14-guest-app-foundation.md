# Epic 14 — Guest App Foundation (PWA)

> **Scope:** The guest-facing PWA — a **new Next.js project** (`gxp-guest-frontend`) and the fourth surface of the platform. This epic ships the foundation everything guest-side builds on: the entry/session flow (consuming Epic 13.5's contract verbatim), the **7-language i18n foundation** (ar, en, ru, fr, it, es, de — this absorbs the planned Guest Localization epic), the home screen, and the PWA machinery.
>
> **The prime directive of this epic: it must feel like a native app, not a website.** Guests will compare it to Instagram and WhatsApp, not to other hotel software. Design and interaction quality outrank feature count everywhere in this epic — see Story 14.5, which is a real story with acceptance criteria, not a vibe.
>
> **Out of scope:** Guest requests (Epic 15 — the services grid ships with "coming soon" states), F&B ordering, push notifications, Capacitor wrapping (architecture stays Capacitor-ready per the standing decision: no browser-only APIs in core flows).
>
> Standing conventions live in the repo CLAUDE.md files. This is a new repo — its own CLAUDE.md ships as part of this epic (implementation note 10).
>
> **No new backend permissions.** Backend work is limited to small additions noted in 14.4/14.6 (hotel public profile endpoint).

---

## Story 14.1 — Project Foundation & PWA Shell

**As the** platform owner,
**I want** a properly engineered PWA foundation,
**so that** the app opens fast on a mid-range Android over hotel WiFi and behaves like an installed app.

### Acceptance Criteria

- **AC1 — New project:** `gxp-guest-frontend`, Next.js App Router, same tooling family as the other frontends. Mobile-only viewport strategy (desktop shows a centered phone-width layout — no desktop redesign).
- **AC2 — PWA manifest:** name/short_name from the resolved hotel where possible, standalone display, theme-color, maskable icons, correct `viewport-fit=cover` + safe-area-inset handling (notches, home indicators).
- **AC3 — Service worker:** app shell cached for instant repeat opens; an offline fallback screen ("You're offline — reconnect to the hotel WiFi") in the guest's language; **no aggressive caching of API data** in MVP (correctness first).
- **AC4 — Performance budget (enforced, not aspirational):** LCP < 2.5s and TTI < 3.5s on a mid-range Android over throttled 4G (Lighthouse mobile CI check); initial JS budget set and asserted in the build. Fonts subset per script (see 14.3 AC5).
- **AC5 — Tenant resolution:** `/{slug}` resolves the hotel (public branding endpoint — 14.4 AC1); unknown slug → branded "hotel not found"; the Epic 04/05 states render properly: suspended hotel and expired-trial hotel each get a clean, guest-appropriate unavailable screen (no internal details — "This service is currently unavailable. Please contact the front desk.").

---

## Story 14.2 — Entry & Session Flow

**As a** guest scanning a QR,
**I want** to be inside in seconds,
**so that** asking for a towel never feels like creating an account.

### Acceptance Criteria

- **AC1 — URL contract (Epic 11, verbatim):** `/{slug}` → room number + code inputs; `/{slug}?room=304` → room locked/pre-filled, **code input only**; an existing valid session on any URL → straight into the app, params ignored.
- **AC2 — App-like code entry:** the code input is a **6-digit segmented input** (one box per digit), numeric keyboard (`inputmode=numeric`), auto-advance, paste-friendly, auto-submits on the 6th digit. Errors animate (shake + message), never navigate away, never clear the room field.
- **AC3 — Error UX per the contract:** `INVALID_CODE` → "The code doesn't match — check it with the front desk" (in the UI language; generic by design). `TOO_MANY_ATTEMPTS` → friendly lockout screen with a live retry-after countdown. `HOTEL_UNAVAILABLE` → the 14.1 AC5 screen.
- **AC4 — Session persistence:** token stored so the app survives browser restarts for the stay's duration; on boot, `GET /guest/me` decides instantly between app and entry screen (skeleton while probing — never a flash of the login).
- **AC5 — Session death:** any 401 mid-use (checkout, regeneration is NOT one — sessions survive regeneration; but checkout/suspension are) routes to a warm goodbye/entry screen: "This stay has ended — we hope you enjoyed your visit!" with the entry form beneath. No error-red anywhere in this moment.
- **AC6 — Multi-device:** nothing blocks the same code on additional devices (per 13.5 AC5) — verified.

---

## Story 14.3 — Seven-Language i18n Foundation

**As a** Russian, German, or Italian guest,
**I want** the entire app in my language from the first screen,
**so that** the hotel feels like it expected me.

### Acceptance Criteria

- **AC1 — Locales:** ar, en, ru, fr, it, es, de — full UI coverage in all seven from day one (this epic's screens). Namespaced files + parity check across **all seven** (the Epic 07-style check, extended).
- **AC2 — Language resolution order:** explicit user choice (persisted) → stay's guest language (from the session profile) → browser `Accept-Language` matched against the seven → `en`. Pre-login screens use the last two.
- **AC3 — Switcher:** always reachable (entry screen and in-app), native-app style (bottom sheet, flags + endonyms: العربية, Русский, Deutsch...). Switching is instant, preserves state.
- **AC4 — RTL:** Arabic flips the app correctly (logical properties, mirrored directional icons, bidi isolation for room numbers/codes/URLs) — same discipline as the dashboards, now in app-feel context (gestures and transitions mirror too).
- **AC5 — Scripts & fonts:** one type system covering Latin, Cyrillic, and Arabic elegantly (e.g., a Noto/IBM Plex family trio matched in weight/x-height), subset per script, `font-display: swap`, no FOIT on slow WiFi.
- **AC6 — Formatting:** dates/relative times localized per locale (checkout "until Sat, 24 Aug" / «до сб, 24 авг.»); Latin digits everywhere; ICU plurals wired (Russian's complex plural rules are the test case: 1 ночь / 2 ночи / 5 ночей).

---

## Story 14.4 — Home Screen

**As a** checked-in guest,
**I want** one glance to show me my stay and what I can do,
**so that** the app immediately proves its worth.

### Acceptance Criteria

- **AC1 — Hotel public profile (small backend addition):** `GET /guest/{slug}/profile` (public, cached) returns branding basics: hotel display name, logo, brand accent color (new optional hotel field, default GXP navy), languages note if needed. Guest-appropriate only — nothing internal.
- **AC2 — Composition:** hotel logo/name header → personal greeting in the guest's language with their name ("Добро пожаловать, Дмитрий!") → **stay card**: room number (large), nights remaining, checkout date + hotel checkout time → **services grid**.
- **AC3 — Services grid:** tiles for what's coming (Requests, Dining, Housekeeping, Transport, Hotel Info) rendered as elegant "soon" states in MVP — visible ambition, disabled interaction, one tasteful "soon" treatment (no gray sadness). Tiles are config-driven so Epic 15 activates Requests by flipping a flag, and plan `enabled_modules` gates tiles per hotel from day one.
- **AC4 — Checkout awareness:** the last day, the stay card gently notes checkout time ("Checkout today at 12:00 — we hope you enjoyed your stay"). Warm, not alarming.
- **AC5 — Guest App branding module hook:** if the hotel's plan includes `guest_app_branding`, the accent color + logo treatment applies fully; otherwise defaults apply. (Full branding customization UI is a future epic — the rendering path ships now.)

---

## Story 14.5 — App-Like Experience (The Design Story)

**As a** guest,
**I want** every touch to feel like a native app,
**so that** I trust it the way I trust the apps on my home screen.

### Acceptance Criteria

- **AC1 — No website tells:** no visible scrollbars on mobile, no hover-dependent anything, no blue links, no text cursor on labels, no accidental text selection on UI chrome, no browser-default focus rings (custom ones instead), no layout shift (CLS ≈ 0), `overscroll-behavior` tuned (no page-bounce chaining), long-press context menus suppressed on UI elements.
- **AC2 — Motion system:** screen-to-screen transitions (slide/fade, 200–300ms, eased) — mirrored in RTL; bottom sheets with drag-to-dismiss for pickers/switchers; tap feedback within 100ms on every interactive element (pressed states — scale/opacity); skeletons for every loading state (never spinners alone, never blank screens); reduced-motion respected.
- **AC3 — Touch ergonomics:** minimum 44×44px targets; primary actions in the thumb zone (bottom half); the shell reserves a bottom-nav slot (activates when Epic 15 adds sections — MVP may be single-screen but the architecture is nav-ready); safe-area padding everywhere.
- **AC4 — Visual quality bar:** a defined guest design system (type scale, spacing, radii, elevation, color roles incorporating the hotel accent) — premium-hospitality feel, closer to a boutique hotel's aesthetic than to enterprise software. The entry screen and home screen ship pixel-polished: these two screens ARE the demo.
- **AC5 — App-like details:** theme-color matches the header (status bar blends), pull-to-refresh only where meaningful (home), keyboard handling on the code input (viewport doesn't jump), and the add-to-home-screen moment is native-prompted where available — never a nagging banner.
- **AC6 — Review gate:** the epic's final review includes an explicit design pass on a real Android device and an iPhone (RTL + ru + de checked) against AC1–AC5 — failing feel, not just failing function, blocks completion.

---

## Story 14.6 — Guest-Facing State Screens

**As a** guest hitting an edge case,
**I want** every dead end to be warm and useful,
**so that** the app never embarrasses the hotel.

### Acceptance Criteria

- **AC1 — The set:** offline, hotel not found, hotel unavailable (suspended/expired — indistinguishable to guests), stay ended (warm goodbye), rate-limited (countdown), generic error (retry action). Each: illustration-quality visual, guest-language copy, and the one action that helps ("Contact the front desk" where relevant).
- **AC2 — Tone rule:** guest-facing copy never mentions internal concepts (trial, subscription, tenant, session, 401). Translated in all seven languages like everything else.

---

## Implementation Notes for Claude Code

1. **Consume, don't touch:** the session contract (13.5) is consumed as-is — `POST /guest/{slug}/session`, `GET /guest/me`, error codes verbatim. The only backend additions: the public profile endpoint (14.4 AC1, cache 60s+), the optional `brand_accent_color` hotel column (+ migration), and wiring `enabled_modules` into the profile response for tile gating. Nothing else backend-side.
2. **i18n architecture:** same library family as the dashboards, but locale files ship all seven; the parity check runs across seven. Translation quality: professional register per language; Russian and German reviewed extra carefully (largest guest segments). Keep locale list in ONE constant (shared with the language dropdown from Epic 13's check-in — same seven, same order).
3. **Session storage:** persistent storage for the guest token (survives restarts); axios/fetch layer auto-attaches it and routes 401s to the session-death flow (14.2 AC5). Token in memory + persisted — never in URLs.
4. **The `?room=` param** only pre-fills the entry form — it is never trusted for anything else and is dropped once a session exists (per contract).
5. **Motion/interaction stack:** pick one animation approach (CSS view transitions or a single small library) and use it consistently — no mixed animation systems. Bottom sheet component built once, reused (language switcher first).
6. **Fonts:** three-script strategy per 14.3 AC5 — subset builds per locale group, preload only the active script's files.
7. **Performance CI:** Lighthouse (mobile, throttled) in the pipeline with budgets from 14.1 AC4 — a red budget fails the build like a red test.
8. **Design tokens:** guest app gets its own token set (do NOT import the dashboard's — different product feel), with the hotel accent color injected at runtime from the profile endpoint (CSS custom property).
9. **Testing:** component tests for the segmented code input (auto-advance, paste, RTL), language resolution order, session boot branching, tile gating by modules; the seven-locale parity check; Lighthouse budget check. Build + all suites clean.
10. **CLAUDE.md for this repo:** author it as part of this epic — base it on the tenant frontend's structure but guest-specific: the prime directive (app-not-website), the seven-locale rule + parity, the contract-consumption rule (never redefine backend shapes), performance budgets as law, motion/touch standards, Capacitor-readiness (no browser-only APIs in core flows), and the specs cross-reference.

---

## Notes & Dependencies

- **Depends on:** Epic 13 merged and deployed (session contract live), Epic 11 (QR URLs pointing at `/{slug}`), Epic 04 `enabled_modules` (tile gating).
- **Blocks:** Epic 15 (Guest Requests — activates the first tile), all future guest modules (F&B, transport, info directory).
- **Deferred:** push notifications, Capacitor build, hotel-customizable branding UI (rendering path ships now), guest feedback module, offline request queueing.
