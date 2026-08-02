# Epic 06 — Notifications (Platform Infrastructure + Super Admin Dashboard)

> **Scope:** Platform-wide notification infrastructure (email channel first) plus the Super Admin UI to monitor it. This epic unblocks the deferred hooks from earlier epics: automated **owner setup-link emails** (Epic 05, Story 5.6 AC5) and **trial countdown / expiry notices** (Epic 04, Story 4.10 AC4). It is built as reusable infrastructure — the Tenant Dashboard and Guest App will later emit their own notifications through the same pipeline. WhatsApp/SMS channels are future phases; the channel abstraction must make adding them straightforward.
>
> **Permission catalog additions:**
> `notifications.read`, `notifications.resend`
>
> Super Admin wildcard `*` covers all of the above.

---

## Story 6.1 — Notification Outbox (Reliable Delivery Core)

**As the** platform owner,
**I want** every notification to be persisted before sending and tracked through its lifecycle,
**so that** no notification is silently lost and everything is auditable.

### Acceptance Criteria

- **AC1 — Persist first:** Every notification is written to an outbox record **before** any send attempt, with: type (e.g., `owner_setup_link`, `trial_countdown_7d`), channel (`email` for now), recipient (name, address, related hotel/tenant-user), language used, subject, rendered body reference, status, timestamps.
- **AC2 — Lifecycle statuses:** `pending` → `sent` | `failed`. Failed sends are retried automatically with exponential backoff (default: 3 attempts) before landing on `failed`. Attempt count and last error message are stored.
- **AC3 — Decoupled emission:** Business services (subscriptions, hotels, ...) emit **events**; the notifications module consumes them and creates outbox records. Business logic never calls the email provider directly and never fails because a notification failed.
- **AC4 — Idempotency:** Re-processing the same event does not create duplicate notifications (idempotency key per event occurrence, e.g., `trial_countdown_7d` + subscription id + date).

---

## Story 6.2 — Email Channel with Configurable Provider

**As the** platform owner,
**I want** the email provider to be swappable via environment config,
**so that** development, staging, and production can use different providers without code changes.

### Acceptance Criteria

- **AC1 — Driver pattern:** `MAIL_DRIVER` env selects the provider — mirroring the storage-driver pattern from Epic 05. Minimum drivers: `log` (writes the rendered email to the app log / outbox only — default for development) and `smtp` (generic SMTP via env: host, port, user, password, from-address, from-name). The interface must allow adding `ses` or API-based providers later without touching callers.
- **AC2 — From identity:** All emails send from a configurable platform identity (e.g., "GXP Platform <no-reply@...>"), env-driven.
- **AC3 — Failure isolation:** Provider errors are captured into the outbox record (Story 6.1 AC2) — they never bubble up into API responses or crash jobs.

---

## Story 6.3 — Bilingual Email Templates (AR/EN, RTL-Safe)

**As a** hotel owner receiving platform emails,
**I want** emails in my hotel's default language with correct RTL rendering,
**so that** communication feels professional and native.

### Acceptance Criteria

- **AC1 — Language selection:** Template language follows the hotel's `default_language` (`ar` default). Platform-admin-facing emails (if any) follow `en` unless specified.
- **AC2 — RTL correctness:** Arabic templates render fully RTL (dir="rtl", right-aligned text, correct punctuation placement) and are tested in common clients' constraints (table-based layout, inline CSS, no external stylesheets).
- **AC3 — Shared layout:** One base layout (logo, brand colors navy `#0E2A47` / gold `#C8A24A`, footer) with content partials per notification type. Templates are **code-versioned** (files in the repo), not DB-editable — template management UI is out of scope.
- **AC4 — Required templates for this epic:** owner setup link, trial countdown (7/3/1 days — one template, parameterized), trial expired, hotel suspended, hotel reactivated. Each in AR + EN.
- **AC5 — Variables:** Templates receive typed variables (hotel name, owner name, days remaining, setup URL, ...). A missing variable fails loudly at render time in development and is caught into `failed` status in production — never sent half-rendered.

---

## Story 6.4 — Automated Owner Setup-Link Email

**As a** platform admin onboarding a hotel,
**I want** the owner's setup link emailed automatically,
**so that** I no longer need to share it manually.

### Acceptance Criteria

- **AC1 — Trigger:** On onboarding completion (Epic 05, Story 5.3) and on setup-link regeneration (Story 5.6 AC4), an `owner_setup_link` email is queued to the owner's address in the hotel's language.
- **AC2 — Token handling:** The email contains the setup URL with the raw token. The token itself is still never persisted raw — it flows from the generating service to the rendered email only. Outbox stores the rendered-body reference without exposing the token in queryable plaintext fields.
- **AC3 — Manual fallback stays:** The one-time copy-link screen from Epic 05 remains (useful if the hotel's email is unreachable). The UI now shows the email delivery status alongside it.
- **AC4 — Expiry unchanged:** 72h single-use semantics from Epic 05 are unchanged.

---

## Story 6.5 — Trial Countdown & Expiry Emails

**As a** hotel owner on a trial,
**I want** reminders before my trial ends and a notice when it expires,
**so that** I can convert in time without surprises.

### Acceptance Criteria

- **AC1 — Countdown triggers:** The daily trial job (Epic 04, Story 4.10) emits events at 7, 3, and 1 day(s) remaining. Each results in one email to the hotel owner in the hotel's language, showing days remaining and how to convert (contact instructions for now — self-serve billing is a future epic).
- **AC2 — No duplicates:** A given hotel receives each threshold email at most once per trial (idempotency per Story 6.1 AC4), even if the job re-runs or was down and catches up (e.g., if the 7-day run was missed and 6 days remain, send the 7-day notice once — never twice).
- **AC3 — Expiry notice:** When the job transitions a trial to `expired`, an expiry email is sent explaining read-only mode and conversion steps.
- **AC4 — Extension awareness:** If Super Admin extends a trial (Story 4.10 AC6), thresholds re-arm relative to the new `trial_ends_at` (an extension from 1 day to 10 days means the 7/3/1 notices apply again for the new dates).

---

## Story 6.6 — Hotel Suspension / Reactivation Notices

**As a** hotel owner,
**I want** to be informed when my hotel is suspended or reactivated,
**so that** the lockout is never a silent surprise.

### Acceptance Criteria

- **AC1 — Suspension email:** On `hotel.suspended`, the owner receives an email stating the suspension category (from the reason enum — the internal free-text note is **not** included) and platform contact instructions.
- **AC2 — Reactivation email:** On `hotel.reactivated`, the owner receives a confirmation that access is restored.
- **AC3 — Language:** Both follow the hotel's `default_language`.

---

## Story 6.7 — Notifications Log (Super Admin UI)

**As a** platform admin with `notifications.read`,
**I want** to see every notification the platform has sent or attempted,
**so that** I can support hotels ("I never got the email") and monitor delivery health.

### Acceptance Criteria

- **AC1 — Access control:** `GET /notifications` and the sidebar item require `notifications.read`; otherwise `403` / hidden.
- **AC2 — List:** Paginated table: date, type, recipient, hotel, channel, language, status (with attempt count on failures). Filters: status, type, hotel, date range. Search by recipient.
- **AC3 — Detail view:** Clicking a record shows the rendered email (subject + body preview) and the delivery timeline (attempts, errors). Setup-link emails render the body with the token **masked**.
- **AC4 — Resend:** Admins with `notifications.resend` can resend a `failed` notification (creates a fresh outbox record referencing the original; audit-logged `notification.resent`). Resending `owner_setup_link` follows the regeneration flow (new token, old invalidated) rather than resending the stale body.
- **AC5 — Hotel details integration:** The hotel details page (Epic 05) gains a **Notifications** tab listing that hotel's notifications, same permission gating.

---

## Implementation Notes for Claude Code

Guidance and constraints for planning/implementing — structure and layout are up to you, but follow existing project conventions (NestJS clean architecture: thin controllers, service-layer logic, global JWT + Permissions guards; Next.js admin frontend with brand tokens navy `#0E2A47` / gold `#C8A24A`; bilingual EN/AR UI, RTL-safe).

1. **Outbox pattern is the core:** persist → attempt → update status. No fire-and-forget sends anywhere. Retries with exponential backoff (max attempts env-configurable, default 3) via a scheduled/queued worker — a simple `@nestjs/schedule` poller over `pending`/retryable records is acceptable now; don't introduce Redis/BullMQ unless already present in the project.
2. **Event-driven decoupling:** use Nest's event emitter (or equivalent in-process events). Emitters: onboarding service (`hotel.owner_setup_link_requested`), trial job (`subscription.trial_countdown`, `subscription.trial_expired`), hotels service (`hotel.suspended`, `hotel.reactivated`). The notifications module owns all listening, template rendering, and sending. **Never** let a notification failure fail the emitting business operation.
3. **Mail driver mirrors the storage driver pattern** from Epic 05: one interface, `MAIL_DRIVER=log|smtp` env selection, `log` as default. Suggested env: `MAIL_DRIVER`, `SMTP_HOST/PORT/USER/PASS/SECURE`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `NOTIFICATION_MAX_ATTEMPTS`.
4. **Idempotency keys** (unique constraint on the outbox): deterministic per event occurrence — e.g., `{type}:{subscription_id}:{threshold}` for countdowns, `{type}:{token_id}` for setup links. Catch unique-violation as "already queued, skip".
5. **Trial countdown catch-up logic:** compute which thresholds (7/3/1) apply from `trial_ends_at` vs. today; queue any un-sent applicable threshold exactly once. Extension re-arms thresholds because keys include the threshold and the (new) dates make them applicable again — verify this in tests.
6. **Token security:** raw setup token exists only in memory between generation and the rendered send; outbox must not store it in plaintext queryable columns; log-driver output must mask it; UI preview masks it (Story 6.7 AC3).
7. **Templates:** code-versioned files (e.g., MJML/Handlebars/React Email — pick one and stay consistent), table-based layout, inline CSS, `dir="rtl"` for Arabic. One base layout + per-type partials. Typed variable interfaces per template; missing variable ⇒ render error ⇒ `failed` status, never a half-rendered send.
8. **Language resolution:** hotel `default_language` decides; default `ar`. Keep the resolution in one function — Guest App notifications will later add per-guest language on top.
9. **Extend, never recreate:** hotel details page gains a Notifications tab (Epic 05 UI); the trial job from Epic 04 is extended to emit events — don't duplicate it.
10. **Audit:** `notification.resent` via the existing audit mechanism. The outbox itself is append-only history — no delete endpoints.
11. **Tests (service layer minimum):** outbox lifecycle + backoff, idempotency (double-emit ⇒ one record), countdown catch-up + extension re-arm, render failure ⇒ `failed`, token masking, resend of setup link goes through regeneration. Keep the TypeScript build clean.

---

## Notes & Dependencies

- **Depends on:** Epics 04–05 (trial job, onboarding/setup tokens, hotel details page, audit mechanism).
- **Unblocks:** Epic 05 Story 5.6 AC5 (automated setup email) and Epic 04 Story 4.10 AC4 (countdown delivery) — both now fulfilled.
- **Reused by (future):** Tenant Dashboard (staff invites, operational alerts), Guest App (request status updates — WhatsApp/SMS channels planned there), Billing epic (payment receipts, past-due notices).
- **Deferred:** WhatsApp/SMS channels, in-app notification bell for admins, notification preferences/opt-outs, DB-editable templates, dedicated queue infrastructure (Redis/BullMQ) — revisit when channel volume grows.
