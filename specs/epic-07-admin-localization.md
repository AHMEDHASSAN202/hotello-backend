# Epic 07 — Admin Dashboard Localization (Arabic + English, RTL)

> **Scope:** Full internationalization of the **Super Admin Dashboard UI** in Arabic and English, with complete RTL layout when Arabic is active. This supersedes the earlier interim pattern (English-only UI chrome with bilingual data fields): after this epic, **every UI string** — navigation, buttons, table headers, forms, dialogs, validation and error messages, empty states — exists in both languages.
>
> **Out of scope:** The Guest App's 7-language support (Arabic, English, Russian, French, Italian, Spanish, German) — that is a separate future epic before the Guest App build. However, the i18n foundation built here must be reusable for it and for the Tenant Dashboard (also AR/EN).
>
> **Data fields are unchanged:** bilingual data entry (`name_en` / `name_ar` with `dir="rtl"` on Arabic inputs) stays exactly as is. This epic is about the **interface language**, not the data model.
>
> **Permission catalog:** No new permissions — language preference is personal to each admin, not a managed resource.

---

## Story 7.1 — i18n Foundation

**As the** platform owner,
**I want** a proper i18n infrastructure in the admin frontend,
**so that** every UI string is translatable and no string is ever hardcoded again.

### Acceptance Criteria

- **AC1 — Translation files:** All UI strings live in structured locale files (`en`, `ar`), organized by feature/namespace (e.g., `common`, `auth`, `admins`, `roles`, `plans`, `hotels`, `notifications`). No hardcoded user-facing strings remain in components.
- **AC2 — Interpolation & plurals:** The system supports variable interpolation ("Showing {count} hotels") and Arabic plural rules (Arabic has 6 plural forms — zero/one/two/few/many/other; "3 فنادق" vs "11 فندقًا" must render grammatically correctly).
- **AC3 — Missing-key behavior:** In development, a missing translation key fails loudly (visible warning); in production it falls back to English rather than showing raw keys.
- **AC4 — Completeness check:** A script verifies `en` and `ar` files have identical key sets; a mismatch fails the check (same spirit as the migrations sync check).

---

## Story 7.2 — Language Switcher & Persistence

**As a** platform admin,
**I want** to switch the dashboard language and have it remembered,
**so that** I always see the dashboard in my preferred language.

### Acceptance Criteria

- **AC1 — Switcher:** A language switcher (EN ⇄ العربية) is available in the top bar/user menu on every page, including the login page.
- **AC2 — Persistence:** The choice persists across sessions and devices: stored on the admin's profile (`preferred_language`, default `en`) and applied on login; a cookie covers the pre-login pages (login screen respects the last choice on that browser).
- **AC3 — Instant apply:** Switching applies immediately without losing page state (current route, filled form values, active filters are preserved).
- **AC4 — Independence:** The UI language never alters stored data or which data-language columns are shown — an Arabic UI still shows both `name_en` and `name_ar` fields in forms.

---

## Story 7.3 — RTL Layout

**As a** platform admin using Arabic,
**I want** the entire layout to flow right-to-left correctly,
**so that** the Arabic experience feels native, not mirrored-broken-English.

### Acceptance Criteria

- **AC1 — Document direction:** Arabic sets `dir="rtl"` and `lang="ar"` at the document level; English sets `dir="ltr"` / `lang="en"`.
- **AC2 — Layout flip:** Sidebar moves to the right; table columns, breadcrumbs, pagination controls, drawers/modals, toasts, wizard steppers (e.g., the `/hotels/new` onboarding stepper), tabs, and dropdown alignments all flip correctly.
- **AC3 — Logical properties:** Spacing/positioning uses direction-aware styling (logical properties / RTL-aware utilities) rather than hardcoded left/right — no per-page manual flipping.
- **AC4 — Directional icons:** Arrows/chevrons indicating direction (back, next, expand) mirror in RTL; non-directional icons (search, trash, edit) do not.
- **AC5 — Mixed content:** Latin content inside RTL context (emails, slugs, URLs, code-like values such as permission keys `hotels.read`) renders LTR inline with correct isolation (no scrambled punctuation) — slugs and URLs must never visually reorder.
- **AC6 — Charts & tables:** Numeric tables and any charts remain readable in RTL (axis labels, legends aligned correctly).

---

## Story 7.4 — Translate All Existing Pages

**As a** platform admin using Arabic,
**I want** every existing screen fully translated,
**so that** no part of the dashboard falls back to English mid-flow.

### Acceptance Criteria

- **AC1 — Coverage:** All existing pages are fully translated in both languages: Login, Overview, Admins (list/create/edit), Roles & permission matrix, Plans (list/details/create/edit/subscribers tab), Hotels (list/onboarding wizard/details tabs/suspend dialogs), Notifications log (list/detail/resend), plus global chrome (sidebar, top bar, user menu, error pages, confirmation dialogs).
- **AC2 — Permission matrix nuance:** Permission **keys** (`admins.read`, `*`) always display as-is (LTR code style); their human descriptions are translated.
- **AC3 — Validation & API errors:** Client-side validation messages are translated. API error messages surfaced to the UI map to translated strings via error codes (the API returns stable codes; the frontend owns the wording) — raw English backend messages must not leak into the Arabic UI.
- **AC4 — Empty states & confirmations:** Empty states, destructive-action confirmations, and success toasts are translated — these are the most commonly forgotten strings.

---

## Story 7.5 — Localized Formatting

**As a** platform admin using Arabic,
**I want** dates, numbers, and currency formatted appropriately,
**so that** the dashboard reads naturally in each language.

### Acceptance Criteria

- **AC1 — Digits:** Both languages use Latin digits (0-9) everywhere — standard for Egyptian business software; Eastern Arabic numerals (٠-٩) are **not** used.
- **AC2 — Dates:** Dates/times format per locale (Arabic month names in AR UI; e.g., "١٥" stays "15" but "March" becomes "مارس"), Gregorian calendar in both, consistent timezone handling as already established (`Africa/Cairo` platform default).
- **AC3 — Currency & counts:** Currency amounts show the correct symbol/code placement per locale (e.g., "EGP 1,500" / "١٬٥٠٠ ج.م" → use "1,500 ج.م" per AC1's Latin digits); large numbers use locale-correct grouping.
- **AC4 — Relative time:** Relative timestamps ("3 days ago" / "منذ 3 أيام") are localized where used (e.g., notifications log, last login).

---

## Implementation Notes for Claude Code

Guidance and constraints — structure is up to you, but follow existing project conventions (Next.js admin frontend, brand tokens navy `#0E2A47` / gold `#C8A24A`; NestJS backend: thin controllers, service-layer logic).

1. **Library choice:** use `next-intl` (or an equivalent mature Next.js i18n library already compatible with the project's App Router setup) — don't hand-roll i18n. Locale strategy: cookie/profile-based (no locale URL prefix needed for an internal dashboard — avoid changing all routes).
2. **This is a refactor epic:** the main work is extracting every hardcoded string from existing components into namespaced locale files. Do it page by page, keeping each page fully working in both languages before moving on. Don't restructure components beyond what string extraction requires.
3. **RTL via logical properties:** prefer CSS logical properties / RTL-aware utility classes over `[dir="rtl"]` overrides. If the project uses Tailwind, use `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-` utilities in place of `ml-`/`mr-`/etc. — migrate existing classes as you touch each page.
4. **Bidi isolation:** wrap user-generated/code-like LTR values (emails, slugs, URLs, permission keys) in bidi isolation (`<bdi>` or `unicode-bidi: isolate`) when rendered inside Arabic text — this is the #1 source of "scrambled" RTL bugs.
5. **Backend addition (small):** add `preferred_language` (`en`|`ar`, default `en`) to the admin entity + expose it in the profile update endpoint. Schema note: `synchronize: true` is still active at this point (migrations task comes after this epic) — a plain entity change is fine.
6. **Error codes contract:** where backend errors currently return raw messages consumed by the UI, introduce stable error codes in responses (keep the English message alongside for logs/API consumers). Frontend maps codes → translated strings. Add codes only for errors the UI actually surfaces — don't boil the ocean.
7. **Arabic plural forms:** rely on the library's ICU plural support; hand-written `count === 1 ? ... : ...` logic is a bug in Arabic. Test with counts 0, 1, 2, 3, 11, 100.
8. **Arabic translation quality:** write the Arabic strings in professional Modern Standard Arabic (فصحى مبسطة) appropriate for business software — not literal word-for-word translation. Keep established technical terms commonly left in English (e.g., "Slug") transliterated or explained once, consistently.
9. **Reusability:** keep the i18n setup (config, formatting helpers, completeness-check script) cleanly separable — the Tenant Dashboard (AR/EN) and later the Guest App (7 languages: ar, en, ru, fr, it, es, de) will reuse the same pattern. Don't hardcode the locale list in more than one place.
10. **Login page edge case:** the login page renders pre-auth — it reads the cookie locale, and after login syncs to the profile's `preferred_language` (profile wins; cookie updates to match).
11. **Tests:** completeness-check script wired into the build/CI; unit tests for the formatting helpers (dates, plurals, currency) in both locales; keep the TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epic 06 (Notifications) being implemented first — so its log UI pages exist and get translated in this epic's single pass (Story 7.4 AC1 includes them).
- **Supersedes:** the Epic 05 interim decision "English UI chrome, bilingual data fields only" — that pattern was correct then; this epic replaces it.
- **Followed by:** the migrations-setup task (`task-migrations-setup.md`) — run it after this epic so the baseline captures `preferred_language` too.
- **Future reuse:** Tenant Dashboard (AR/EN, same infra), Guest App Localization epic (7 languages + translatable hotel content fields — separate epic before the Guest App build; it will extend the data model, unlike this epic).
