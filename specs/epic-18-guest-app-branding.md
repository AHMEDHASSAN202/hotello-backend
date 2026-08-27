# Epic 18 — Guest App Branding

> **Scope:** The first real upsell module. Hotels on plans that include `guest_app_branding` customize how their Guest App looks — accent color, home cover image, welcome message — from a Tenant Dashboard page with a **live phone preview**. Hotels without the module see a tasteful upsell state on that page, and their guests get the polished GXP defaults (the rendering path from 14.4 AC5 — already live).
>
> **Scope discipline:** accent color + cover image + welcome message. NOT full theming — no font pickers, no layout options, no custom CSS. Three knobs a hotel manager can't ruin the design with; the design system stays in control of everything else.
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `branding.manage`
> Seeded roles: Manager only. Module key: `guest_app_branding` (already in the platform catalog since Epic 04).

---

## Story 18.1 — Branding Management Page (with Live Preview)

**As a** hotel user with `branding.manage` on a plan with the module,
**I want** to set my guest app's look and see it before saving,
**so that** the app feels like MY hotel with zero design skills.

### Acceptance Criteria

- **AC1 — The three knobs:**
  - **Accent color:** color picker + hex input. **Contrast safety is enforced, not suggested:** the picker computes WCAG contrast live; colors that would make text/controls unreadable (against the app's light surfaces and on-accent white text) are blocked with a plain-language explanation and a nearest-safe suggestion. The design system decides *where* the accent applies — the hotel only picks the hue.
  - **Cover image:** optional home-header photo (storage-driver upload, two renditions like F&B, wide-crop guidance in the picker). Without it, the current clean header stays.
  - **Welcome message:** one short line under the greeting ("أهلاً بكم في قلب الغردقة") — AR + EN required, other 5 optional with EN fallback (standard pattern). Length-capped (80 chars) so it can't wreck the layout.
- **AC2 — Live phone preview:** the page shows a static phone-frame mock of the guest home (greeting, stay card, tiles) re-rendering instantly as the knobs change — built from the real guest design tokens so the preview is honest, not an approximation. RTL preview toggles with an AR/EN switch.
- **AC3 — Apply & reset:** Save applies (guests see it within the profile cache window); "Reset to defaults" per knob and globally, with ConsequenceNote. Audit `branding.updated` with diffs (color values, image changed, message diffs).
- **AC4 — Logo note:** the logo stays sourced from the hotel profile (Epic 05) — single source of truth; the page links there with a guidance line instead of duplicating an upload.

---

## Story 18.2 — Guest App Application

**As a** guest,
**I want** the hotel's identity woven through the app,
**so that** it feels like the hotel built this for me.

### Acceptance Criteria

- **AC1 — Profile extension:** `GET /guest/{slug}/profile` gains `coverImageUrl` and localized `welcomeMessage` beside the existing `brandAccentColor` — module-gated server-side: hotels without the module return defaults regardless of stored values (turning the module off un-applies branding instantly, keeps data for re-enable).
- **AC2 — Application points:** accent flows through the existing runtime CSS custom property (buttons, active nav, chips, progress states — wherever the design system routes it); cover renders as the home header with a legibility scrim (text stays readable over any photo); welcome message sits under the greeting in the guest's language.
- **AC3 — Graceful defaults:** no cover → current header; no message → nothing (no empty gap); bad/missing image URL → silent fallback to default header. PWA `theme-color` follows the accent so the status bar blends (14.5 AC5 continuity).
- **AC4 — Performance:** cover lazy-sized per viewport, cached immutably; branding adds no measurable LCP regression (budget check stays green).

---

## Story 18.3 — Upsell State (Module Not in Plan)

**As a** hotel owner on a plan without branding,
**I want** to see what I'm missing, beautifully,
**so that** upgrading feels like unlocking, not paying.

### Acceptance Criteria

- **AC1 — The page still exists:** nav shows Branding with a small "ترقية / Upgrade" affordance (NOT the generic "soon" badge — this module is built, just not in their plan). The page renders the phone preview **with sample branding applied** (a tasteful demo color + stock cover) in a read-only state, controls visually present but locked.
- **AC2 — Honest copy:** one clear line: "متاح في باقة أعلى — تواصل مع فريق GXP للترقية" (per current sales motion — no self-serve upgrade yet). No dark patterns, no fake countdowns.
- **AC3 — Distinction test:** module-in-plan-but-no-permission shows the standard permission-hidden behavior (nav hidden) — the upsell state is strictly for plan gating. Covered by tests.

---

## Implementation Notes for Claude Code

1. **Storage:** extend the hotel entity/table (columns or a small `branding` JSONB: accent hex, cover key, welcome translations) — migration in-PR. Values persist when the module is off (AC 18.2-1 semantics); server-side gating lives in the profile endpoint, not the client.
2. **Contrast math:** implement WCAG relative-luminance ratio (tiny pure function, unit-tested with known pairs) — block below 3:1 for the on-accent white-text case and for accent-on-surface UI elements; suggest the nearest passing darkened/lightened variant. This is the one place we protect hotels from themselves.
3. **Preview honesty:** build the phone preview from the guest app's actual token values (export the token map as a tiny shared constant or duplicate deliberately with a sync test — choose and record). Static mock component, not an iframe of the real app.
4. **Cache behavior:** profile cache stays 60s — document in guidance that changes reach guests within a minute ("التغييرات تظهر للضيوف خلال دقيقة").
5. **Module-off tile note:** unlike `hotel_info`'s tri-state, branding has no guest tile — nothing to gate guest-side except the profile values themselves. Don't invent UI.
6. **Reuse inventory:** photo pipeline + PhotoPicker (17's extraction), translations JSONB + NameFields, ConsequenceNote, upsell page pattern is NEW — build it clean, it will be reused by `analytics` (Epic 22) and future premium modules; extract the "locked module page" shell as a shared component from day one.
7. **Tests:** contrast function pairs, module-off returns defaults (values retained), welcome fallback chain, preview token sync, upsell-vs-permission distinction, theme-color follows accent, i18n parity both apps. Device pass: pick a garish-but-passing color and verify the app still looks composed. Builds clean.

---

## Notes & Dependencies

- **Depends on:** Epic 14 (rendering path, tokens), Epic 17's extracted components, Epic 04 module gating.
- **Feeds:** the locked-module shell (note 6) is the reusable upsell surface for Epic 22 (analytics) and beyond; sales demos.
- **Deferred:** self-serve plan upgrades, font/theme choices, per-menu or per-tile imagery, dark mode, email-template branding.

## Decisions made during implementation

- **Storage shape** — three columns on `hotels` (`coverImageThumbKey` text, `coverImageDetailKey` text, `welcomeMessage` jsonb `TranslationMap`), not a branding JSONB blob — matches the small-settings precedent already on the entity. Values persist when the module is off; only the guest profile endpoint gates.
- **Contrast rule** — accent allowed ⇔ `contrast(accent, #FFFFFF) ≥ 3.0`. One rule covers both the on-accent white-text case and accent-on-light-surface UI, because every guest surface is white/near-white. Suggestion algorithm is multiplicative RGB darkening (hue-preserving) in 2% steps until it passes. Enforced server-side in the PATCH (`BRANDING_ACCENT_CONTRAST` + a `suggestion` field); the picker's live contrast readout is UX only, not the source of truth. The contrast lib is deliberately duplicated backend↔hotel-frontend with identical test vectors — the shared vectors are the sync mechanism.
- **Preview honesty (note 3 choice)** — deliberate duplication over a shared package: `hotello-hotel-frontend/src/components/branding/guest-tokens.ts` freezes the guest app's token values, and a vitest sync test reads the sibling guest repo's `tailwind.config.ts` + `globals.css` from disk and fails on drift. The test self-skips when the sibling repo isn't present (CI).
- **Welcome transport** — the public profile ships the whole `TranslationMap` (it's cached per slug, so the backend can't pre-localize); the guest app resolves it client-side via `localizeField` in a non-`'use client'` module (EN fallback, empty → `null`). Replace semantics: the dashboard always PATCHes all seven `welcome*` fields together; an empty string clears that language; an all-empty map clears the message entirely; a non-empty message requires AR+EN (`BRANDING_WELCOME_REQUIRED`); 80-char cap per locale.
- **Cover renditions** — wide-crop 640×360 (thumb, dashboard) and 1440×810 (detail, guest header), webp q82, fit cover, keys under `branding/{hotelId}/`. The `files/` route serves `branding/` as immutable (1y cache). The guest profile exposes only the detail URL, as `coverImageUrl`.
- **Reset semantics** — PATCH `brandAccentColor: ''` clears the accent; all-empty welcome fields clear the message; `DELETE /tenant/branding/cover` clears the cover; a "reset everything" action on the frontend issues a PATCH + a DELETE (two audit entries, each with an accurate diff). Audit action is `branding.updated` on `hotel` with field diffs; cover diffs render as `{ coverImage: { changed: true } }` or `{ coverImage: { removed: true } }`.
- **Nav upsell (18.3)** — a new `upsell: true` flag on the sidebar `NavItem` exempts Branding from the module filter while the permission filter still applies (the AC3 distinction). The locked page renders all three controls disabled inside the shared `ModuleUpsell` shell with a demo preview; the demo cover is an accent-driven CSS gradient inside `PhonePreview` (`demoCover` prop) — no binary stock photo checked into the repo.
- **Client permission gate** — the page follows the sibling-page pattern: `hasPermission('branding.manage')` gates the load and renders a `ShieldAlert` empty state on failure, checked before the module-enabled check.
- **Profile cache** — stays 60s, no invalidation hook; the page carries the "changes reach guests within a minute" guidance line instead.
- **Deferred beyond the epic's list** — `branding.firstRun` `HintCard` (guidance copy shipped but unused; backend `TENANT_HINT_KEYS` registration is pending); self-serve upgrades, as already listed above.
