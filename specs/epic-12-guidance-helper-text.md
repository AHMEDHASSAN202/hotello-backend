# Epic 12 — Tenant Dashboard: In-App Guidance & Helper Text (Cross-Cutting)

> **Scope:** A guidance layer across the **entire Tenant Dashboard** — helper text on every form input, tooltips on filters/columns/statuses, page intros, designed empty states, first-run hints, and plain-language confirmations. This epic **retrofits all existing tenant pages** (auth screens, profile, staff, roles, rooms/types/QR/import) and establishes the components + rules every future epic must ship with.
>
> **Why:** Our users are hotel staff in the Egyptian/MENA market — for many of them, this is the **first dashboard they have ever used**. Every screen must answer three questions without training: *What is this page for? What do I type here? What happens if I press this?*
>
> **Out of scope:** The Super Admin dashboard (internal users; may adopt the same components later) and any product tours/videos. No new permissions — guidance is presentation, not a resource.

---

## Story 12.1 — Guidance Component Kit

**As the** platform owner,
**I want** one reusable set of guidance components,
**so that** help looks and behaves identically everywhere and future modules get it for free.

### Acceptance Criteria

- **AC1 — The kit:** A small, consistent component set within the Epic 08 design system:
  - **FieldHelp** — one-line helper text under an input (+ optional example)
  - **InfoTip** — a small ⓘ trigger showing a short explanation (tooltip on desktop, tap-to-open popover on touch — front desk uses tablets)
  - **PageIntro** — one or two plain sentences under each page title stating what the page is for
  - **HintCard** — a dismissible callout for first-run tips ("Start by adding your rooms — guests' requests will arrive from them")
  - **ConsequenceNote** — the standardized explanation block inside confirmation dialogs
- **AC2 — Accessibility & touch:** InfoTip content is reachable by keyboard and by tap (no hover-only information); all components meet the contrast/focus standards from Epic 08.
- **AC3 — i18n:** All guidance strings live in dedicated i18n namespaces (`guidance.*`), AR + EN, RTL-correct.

---

## Story 12.2 — Every Form Input Explains Itself

**As a** first-time hotel user,
**I want** each field to tell me what to enter,
**so that** I never guess and never fear breaking something.

### Acceptance Criteria

- **AC1 — Coverage:** Every input in every existing tenant form has: a clear label, a meaningful placeholder (a realistic example, not the label repeated), and FieldHelp where the field isn't self-evident — e.g., Username: "الاسم اللي هيدخل بيه الموظف — حروف إنجليزية صغيرة وأرقام بس، مثال: ahmed.h" / Role: "بيحدد الصفحات والصلاحيات المتاحة للموظف — تقدر تعدّل الأدوار من صفحة Roles".
- **AC2 — Required clarity:** Required fields are visibly marked and the pattern is explained once per form ("الحقول اللي عليها * إجبارية").
- **AC3 — Validation that teaches:** Every validation message states **what to do**, not just what's wrong — "اسم المستخدم مسموح فيه حروف إنجليزية صغيرة وأرقام و . _ - بس" instead of "Invalid username". Applies to the API error-code mapping layer (Epic 07 pattern) too.
- **AC4 — Sensitive moments get extra words:** One-time screens (temp password display, invite links) explicitly say the item won't be shown again and what to do with it — treat these as the highest-stakes copy in the product.

---

## Story 12.3 — Lists, Filters & Statuses Explain Themselves

**As a** first-time hotel user,
**I want** tables and filters to be understandable at a glance,
**so that** I can find things without knowing dashboard conventions.

### Acceptance Criteria

- **AC1 — Status tooltips:** Every status badge (staff `pending/active/disabled`, room `active/out_of_service/inactive`, and all future ones) has an InfoTip explaining the state in plain words and how it changes — e.g., `pending`: "الموظف اتبعتله دعوة ولسه ما فعّلش حسابه — تقدر تبعت الدعوة تاني من هنا".
- **AC2 — Filter clarity:** Filter groups carry short labels/InfoTips where ambiguous; an active-filters summary with one-tap "Clear filters" is always visible when filters are applied.
- **AC3 — "No results" ≠ "empty":** Filtered-to-zero shows "مفيش نتايج مطابقة للفلاتر دي — جرّب تشيل الفلاتر" (with the clear action); a truly empty section shows the designed empty state (Story 12.4). The two are never the same screen.
- **AC4 — Column sense:** Non-obvious columns (e.g., "Last login", derived counters like "84 / 100 rooms") get header InfoTips.

---

## Story 12.4 — Empty States & First-Run Hints

**As a** hotel user opening a fresh dashboard,
**I want** every empty section to tell me what it will contain and how to start,
**so that** the empty dashboard feels like a checklist, not a dead end.

### Acceptance Criteria

- **AC1 — Empty states everywhere:** Every list/section has a designed empty state (Epic 08 design bar): what this section is, why it matters, and a primary CTA — shown only if the user holds the permission for that CTA (otherwise explanatory text only, e.g., "لسه مفيش أوض متسجلة — اطلب من مدير النظام إضافتها").
- **AC2 — First-run HintCards:** Key pages show a dismissible HintCard on first visit (e.g., Rooms: bulk/Excel options exist; Staff: invite vs direct-add difference). Dismissal is **per user**, persisted server-side (survives devices/browsers).
- **AC3 — Getting-started sequencing:** The dashboard home/overview surfaces a lightweight "setup steps" block for fresh hotels (add rooms → add staff → print QRs), each step linking to its page and auto-checking off when done. Hidden once complete.

---

## Story 12.5 — Confirmations in Plain Language

**As a** hotel user about to perform a consequential action,
**I want** the dialog to state exactly what will happen,
**so that** I act with confidence instead of fear.

### Acceptance Criteria

- **AC1 — ConsequenceNote everywhere:** Every confirmation dialog (disable staff, reset password, deactivate room/type, import commit, …) uses the standardized block: what happens now, what is reversible and how — e.g., disable staff: "مش هيقدر يدخل الداشبورد من اللحظة دي. بياناته وسجلّه محفوظين، وتقدر ترجّعه في أي وقت من نفس المكان".
- **AC2 — Numbers in confirmations:** Where an action affects N things, the dialog says the number ("هيتم إنشاء 28 أوضة") — extending the impact-count pattern (Epic 04, Story 4.4 AC2) as the norm.
- **AC3 — Destructive styling discipline:** Only genuinely irreversible/blocking actions use destructive (red) styling; reversible ones (disable, deactivate) don't — the visual language itself teaches severity.

---

## Story 12.6 — Retrofit Coverage & the Definition of Done

**As the** platform owner,
**I want** the retrofit to be exhaustive and the standard to be permanent,
**so that** guidance never regresses to an afterthought.

### Acceptance Criteria

- **AC1 — Retrofit checklist:** All existing tenant surfaces pass a page-by-page audit against Stories 12.2–12.5: login/setup/reset screens, My Profile, Staff (list/invite/direct-add/edit/reset dialogs), Roles (list/matrix/create/edit/delete), Rooms (list/types/create/bulk/edit/QR & PDFs/Excel import-export). The audit result (page → items added) is included in the implementation report.
- **AC2 — Both languages reviewed:** Every new string exists in AR + EN; Arabic follows the established register (professional فصحى مبسطة — clear, warm, never condescending; technical terms transliterated consistently per Epic 07 note 8).
- **AC3 — The rule going forward:** The i18n completeness check (Epic 07) extends to the `guidance.*` namespaces, and this epic's checklist becomes part of every future epic's definition of done: **no form, filter, list, status, or confirmation ships without its guidance strings.** (Epic files from Epic 13 onward will reference this.)

---

## Implementation Notes for Claude Code

Follow existing conventions (tenant app i18n AR/EN from Epic 07 pattern; design system + accessibility from Epic 08; brand tokens navy `#0E2A47` / gold `#C8A24A`).

1. **This is a content + componentization epic, not a redesign:** build the kit (12.1), then sweep the existing pages replacing ad-hoc labels/dialogs with the kit + strings. Do not restructure layouts beyond what mounting the components requires.
2. **Write the copy as part of the work:** author the actual AR + EN guidance strings (following the tone rules in 12.6 AC2) — don't leave `TODO` keys. Where domain wording is uncertain, prefer plain description of behavior over hospitality jargon.
3. **Hint dismissals:** small `tenant_user_hints` store (user id + hint key + dismissed_at) or a jsonb column on `tenant_users` — pick the simpler fit with the existing entities; expose one endpoint pair (list dismissed / dismiss).
4. **Touch-first InfoTip:** implement as popover-on-tap with outside-tap close; desktop hover is the enhancement, not the base. One component, both behaviors.
5. **Setup-steps block (12.4 AC3):** derive step completion from existing data (rooms count > 0, staff count > 1, …) — no new tracking tables; hide entirely when all complete or when dismissed.
6. **Keep hierarchy discipline:** placeholder = example; FieldHelp = rule/why; InfoTip = deeper context. Never all three saying the same thing — over-explaining is noise, and noise teaches users to ignore help.
7. **Tests:** i18n completeness including `guidance.*` (both locales, key parity), hint dismissal persistence, InfoTip touch accessibility (tap open/close), empty-vs-no-results branching. TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epics 08–11 (the pages being retrofitted; design system; i18n pattern).
- **Applies to:** every future tenant epic via the definition-of-done rule (12.6 AC3) — starting with Epic 13 (Stays).
- **Deferred:** Super Admin dashboard adoption of the kit, interactive product tours, contextual help center/docs links, per-hotel customizable help text.
