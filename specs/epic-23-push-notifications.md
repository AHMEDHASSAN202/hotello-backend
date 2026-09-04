# Epic 23 — Push Notifications (System-Wide)

> **Scope:** Real Web Push to guests' locked phones — built as **platform infrastructure with hooks across the whole system**, not a standalone notification center. One dispatch pipeline; every module that has something worth telling a guest plugs into it: **announcements** (composer toggle), **events** (publish/cancel ride the announcement path + a booked-event reminder), **request status changes**, **F&B order status changes**, and **stay reminders** (checkout morning). Future modules (Laundry) plug in the same way.
>
> **Relationship to Epic 19:** the in-app inbox stays the source of truth for announcements; push is a **delivery layer on top** — exactly the "transport swap" Epic 19's notes promised. Status pushes (orders/requests) are transient by nature: they deep-link into the existing tracking screens, no inbox entries.
>
> **Platform realities (designed for, not around):** push requires guest permission (never browser-prompted cold); iOS requires the PWA to be **installed (A2HS)** before push works — the flow guides that; hotel WiFi + mid-range Androids remain the target.
>
> Standing conventions live in the CLAUDE.md files.
>
> **No new permissions, no new module key** — push enhances existing modules (an infrastructure capability, not a sellable unit). The announcements composer toggle is governed by the existing `announcements.manage`.

---

## Story 23.1 — Push Infrastructure (Subscriptions + Dispatch)

**As the** platform,
**I want** one hardened push pipeline,
**so that** every current and future module sends pushes by emitting an event, never by talking to browsers.

### Acceptance Criteria

- **AC1 — Subscriptions:** VAPID-based Web Push. A `push_subscriptions` table: stay_id, endpoint (unique), keys, coarse device hint, created/last_success/failure_count. Multiple devices per stay (the family-phones rule). Subscribing/refreshing is idempotent per endpoint.
- **AC2 — Dispatch outbox:** pushes follow the Epic 06 outbox discipline — persist → attempt → `sent | failed`, bounded retries with backoff, provider errors captured, **never fire-and-forget**, and a send failure never throws into the emitting business operation.
- **AC3 — Stay validity gates every send:** before dispatch, the stay must still be `active` (same authority rule as sessions) — checkout/suspension silences all of a stay's devices immediately. `410 Gone`/expired endpoints prune the subscription automatically.
- **AC4 — Localized payloads:** title/body composed **server-side** in the guest's language (all 7 locales; content fallback rules as established), with a **deep link** into the relevant app screen. Type-appropriate TTLs (status pushes short-lived; announcements longer).
- **AC5 — One emission API:** modules call a single `pushService.notify(stayIds | audienceFilter, type, payload)` — the service resolves devices, localizes, and dispatches. No module ever handles subscriptions or web-push directly.

---

## Story 23.2 — Permission & Subscription UX (Guest App)

**As a** guest,
**I want** to be asked for notifications at a moment that makes sense,
**so that** saying yes feels obviously worth it.

### Acceptance Criteria

- **AC1 — Contextual pre-prompt, never cold:** the browser permission dialog is only triggered from our own **pre-prompt bottom sheet**, shown at high-intent moments: right after the first order or request is placed ("نبلغك أول ما طلبك يجهز؟ 🔔"), or when opening the announcements inbox. Never on first load. Declining the pre-prompt snoozes it (persisted per device) — we ask again only at the next distinct high-intent moment, max twice per stay.
- **AC2 — iOS path:** on iOS Safari (not installed), the same sheet becomes a two-step guide: install to Home Screen first (illustrated, per-browser instructions), then enable notifications from the installed app. Detected via standalone-mode checks; Android/desktop skip straight to permission.
- **AC3 — Settings row:** a small "الإشعارات" row in the guest app (profile/menu area): current state (on / off / blocked-in-browser with fix instructions), and re-prompt where the platform allows.
- **AC4 — Session lifecycle:** subscriptions bind to the stay at grant time; a new stay on the same device re-binds cleanly; the warm goodbye screen (checkout) notes notifications have stopped.

---

## Story 23.3 — Announcements & Events Integration

**As a** hotel user composing an announcement,
**I want** to choose whether it pushes,
**so that** urgent notices reach pockets and routine ones stay in the inbox.

### Acceptance Criteria

- **AC1 — Composer toggle:** "إرسال إشعار للهواتف 🔔" checkbox on the announcement composer — **default ON for priority announcements, OFF for normal ones** (guidance explains the philosophy: push is attention-expensive). The toggle state shows in the sent-history detail.
- **AC2 — Delivery semantics:** push goes to devices of stays matching the audience filter **at send time** (push is a moment; the dynamic-audience rule stays inbox-only — a guest checking in later sees the inbox item, gets no retroactive push). Deep link opens the inbox at that announcement.
- **AC3 — Events ride through:** the event publish auto-announcement (21.3) inherits the toggle (default ON — a new bookable event is worth a pocket buzz); the event **cancellation** notice to booked guests is **always pushed** (they made plans). No separate event-push code path — it's all the announcement pipeline.
- **AC4 — Quiet hours:** non-priority pushes scheduled into a quiet window (default 22:00–08:00 hotel-local, env-tunable) are **held and delivered at window end** (inbox item appears immediately regardless); priority bypasses. The composer shows a hint when composing inside quiet hours.
- **AC5 — Stats-lite:** the announcement detail gains a push line: sent-to-devices count and failures ("وصل إلى 41 جهازًا").

---

## Story 23.4 — Request & Order Status Pushes

**As a** guest who ordered a mojito from the sunbed,
**I want** my locked phone to buzz when it's on the way,
**so that** I never sit wondering.

### Acceptance Criteria

- **AC1 — Requests:** transitions to `in_progress` and `done` (and staff-`cancelled` with reason category) push to the guest — short localized lines ("طلبك «مناشف إضافية» قيد التنفيذ ✨"), deep-linking to the request's tracking view.
- **AC2 — Orders:** transitions to `preparing`, `on_the_way`, `delivered` (and cancellations) push likewise, item-count-aware wording ("طلبك في الطريق إليك 🛎️ — البسين، شمسية 12" includes the destination for located orders). Deep link to order tracking.
- **AC3 — Sanity:** status pushes are **always-on when subscribed** (no per-type toggles in MVP — the OS toggle exists), guest-language localized, short-TTL (a "preparing" push has no value an hour late), and rapid consecutive transitions collapse to the latest (collapse key per request/order).
- **AC4 — Emission discipline:** hooks live at the existing single transition points (the Epic 15/16 services) — one line per transition calling 23.1 AC5's API. No polling, no duplication.

---

## Story 23.5 — Reminders (The Job-Driven Pushes)

**As a** guest with plans,
**I want** the app to remember for me,
**so that** I never miss the workshop I booked.

### Acceptance Criteria

- **AC1 — Event reminder:** booked guests get a push ~60 minutes before event start ("ورشة اليوجا تبدأ الساعة 5:00 مساءً 🧘 — الشاطئ، مبنى B") — the 5-minute job scans upcoming bookings; idempotent per booking; cancelled bookings/events never remind.
- **AC2 — Checkout-morning reminder:** on departure day at a sensible hour (default 08:30 hotel-local, env-tunable), a warm push ("نتمنى أن تكون استمتعت بإقامتك — المغادرة اليوم 12:00 🌅"), including the unsettled-balance line **only when** one exists ("لديك مشتريات على حساب الغرفة — يمكنك تسويتها عند الاستقبال"). One per stay, idempotent.
- **AC3 — Both localized ×7,** both deep-link (event detail / home), both respect nothing-but-stay-validity (reminders are inherently time-appropriate — quiet hours don't apply at 08:30, and the event reminder is the point).

---

## Implementation Notes for Claude Code

1. **Library & keys:** the standard `web-push` package; `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env (generation documented in `.env.example`); payload encryption handled by the lib.
2. **Outbox shape:** a dedicated `push_dispatches` table following the Epic 06 pattern (don't overload the email outbox — different lifecycle, volume, and retention; record the decision). Retention: prune sent/failed rows after ~30 days via the job.
3. **Service worker:** extend the existing guest SW — `push` handler → `showNotification` (localized payload arrives ready — the SW renders, never composes); `notificationclick` → focus-or-open the deep link. Keep the SW addition minimal; no API caching changes; bundle impact ≈ nil.
4. **Type registry:** one `PushType` registry (type → TTL, collapse-key strategy, quiet-hours applicability, deep-link builder, payload composer) — adding Laundry's "غسيلك جاهز ✨" later = one registry entry + one emission line. Say so in the registry's doc comment.
5. **Quiet-hours hold:** held pushes persist in the outbox with a `deliver_after`; the 5-minute job releases them. Hotel-local via the Intl helpers.
6. **Prompt UX:** the pre-prompt sheet reuses the bottom-sheet component; snooze state persisted like hint dismissals; iOS detection via `display-mode: standalone` + platform checks; the A2HS guide is a designed screen (device pass item), not a text wall.
7. **Multi-device & audience sends:** announcement pushes resolve the audience filter to stays (the Epic 19 visibility function — same source) then fan out to devices; batch the web-push calls with bounded concurrency.
8. **Testing:** dispatch lifecycle + retries + prune-on-410, stay-validity gate (checkout silences), quiet-hours hold/release, collapse behavior, reminder idempotency, payload localization ×7, registry completeness, deep-link building. Push delivery itself gets a **manual device-pass checklist** (Android Chrome + installed iOS PWA) — real pushes can't be CI-verified; say what was hand-verified in the report.

---

## Recorded decisions (planning + execution)

1. Dedicated `push_dispatches` table, never the email `notification_outbox` (note 2): email columns are NOT NULL email-shaped and `attemptSend` hard-codes the mail driver. `NOTIFICATION_CHANNELS` stays `['email']`.
2. Dispatch statuses add `superseded` (collapse replaces still-pending rows); quiet-hold is `deliverAfter` mapped onto `nextAttemptAt`, released by the EVERY_MINUTE retry cron (the 5-minute job in note 5 became the sharper 1-minute outbox poller).
3. Deep links are `/{slug}?open=<target>` — `announcement:<id>`, `request:<id>`, `order:<id>`, `event:<id>`, `home` — relative URLs, resolved against the SW origin (no env needed).
4. `sendPush` is stored on the announcement row: send-from-list (bodyless POST) and the scheduler cron keep the composer's intent.
5. Event publish auto-announcements are created with `sendPush: true` (no per-publish UI toggle in MVP); event cancel always `sendPush: true`.
6. Guest-initiated cancels (requests/orders `cancelOwn`) do not push — the guest performed the action. `assign` never pushes.
7. Reminder idempotency = dispatch `dedupeKey` unique index (`event_reminder:{bookingId}:{subId}`, `checkout_reminder:{stayId}:{subId}`) — outbox strategy, not a stamp column.
8. Push endpoints are guest-JWT-gated only — no module key, no permission (infra, per spec header); the guest strategy's stay/hotel-active check is the availability gate.
9. `pushsubscriptionchange` SW handling deferred (with the rest of the spec's deferred list).

---

## Notes & Dependencies

- **Depends on:** Epics 14 (SW/PWA), 19 (announcement pipeline + visibility), 15/16 (transition points), 21 (bookings), 13 (stay validity, Intl helpers), 06 (outbox discipline).
- **Feeds:** Epic 24 Laundry ("جاهز للاستلام" = one registry entry), future staff-side push (Staff Task PWA epic — explicitly out of scope here; boards keep sound+badge).
- **Deferred:** staff push, per-type guest toggles, rich pushes (images/actions), scheduled announcement pushes beyond quiet-hours, web badge API, push analytics beyond stats-lite.
