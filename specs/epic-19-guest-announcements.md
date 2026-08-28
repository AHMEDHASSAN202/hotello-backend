# Epic 19 — Guest Announcements

> **Scope:** The hotel speaks to its guests. Staff compose announcements ("Pool closed tomorrow 9–12 for maintenance") targeted at **everyone, a filtered audience (stay types / floors / rooms), or one specific guest**, optionally scheduled and time-bounded. Guests get an **in-app inbox + bell with unread badge** (riding the existing delta-polling machinery) and urgent items surface on the home screen. The hotel sees reach + read stats per announcement.
>
> **Channel honesty (stated in-product guidance too):** this is **in-app** messaging. Real push notifications to locked phones are a separate future epic (service-worker push + permissions). In-app covers the core need today — guests open the app often, and urgent items pin to home.
>
> **Text-only by design (MVP):** no images — announcements are operational messages, and this deliberately avoids becoming the sharp-pipeline's fourth inline consumer before the planned extraction.
>
> Standing conventions live in the CLAUDE.md files.
>
> **Tenant permission catalog additions:** `announcements.manage`
> Seeded roles: Manager + Front Desk. **Platform module catalog addition:** new module key `announcements` (backfilled onto existing plans like prior module additions).

---

## Story 19.1 — Compose & Target

**As a** hotel user with `announcements.manage`,
**I want** to write once and reach exactly the right guests,
**so that** the pool-closure notice never spams the city-tower floors.

### Acceptance Criteria

- **AC1 — Compose:** title (short, capped) + body (paragraphs, capped sanely) — AR + EN required, other 5 optional with EN fallback (standard content pattern). Optional **link to a Hotel Info section** (from Epic 17 — "details in Hotel Info" deep-link) rendered as a tappable chip guest-side. Optional **priority flag** ("مهم") — used sparingly per guidance.
- **AC2 — Audience selector:** All current guests · by stay type (multi) · by floor (multi) · by specific rooms (multi-picker) · one specific guest (search active stays by name/room). The selector shows a **live recipient count** ("سيصل إلى 62 ضيفًا حاليًا") before sending.
- **AC3 — Dynamic audience (the key semantic):** the audience is stored as a **filter, not a snapshot** — a guest checking in *tonight* who matches the filter sees the announcement too (while it's active). The live count is labeled "currently" for honesty.
- **AC4 — Guidance DoD:** audience options carry InfoTips (especially the dynamic-audience behavior and the priority flag's "use sparingly" note).

---

## Story 19.2 — Publish, Schedule & Retract

**As a** hotel user with `announcements.manage`,
**I want** control over when messages appear and disappear,
**so that** timing mistakes are fixable.

### Acceptance Criteria

- **AC1 — Timing:** Send now, or **schedule** (hotel-local datetime, reusing the established local-time helpers). Optional **active-until** (after it, the item leaves guest inboxes entirely — expired operational notices are noise). Scheduled items are editable/cancelable until they go live.
- **AC2 — Retract:** a live announcement can be retracted (ConsequenceNote: disappears from all guests immediately, read stats preserved). Retracted/expired items stay in the hotel's sent history, clearly badged.
- **AC3 — Edits:** live announcements are **not editable** (guests may have read version 1) — retract and resend is the flow, stated in guidance. Audit: `announcement.published/scheduled/retracted` (+ `created` for scheduled).

---

## Story 19.3 — Sent History & Read Stats

**As a** hotel manager,
**I want** to see what was sent and whether guests saw it,
**so that** communication is measurable, not hopeful.

### Acceptance Criteria

- **AC1 — List:** all announcements (live / scheduled / expired / retracted) with status badges, audience summary ("All-Inclusive · Floors 2–3"), sent time, and **read stats: "قرأه 34 من 62"** (reads / current-matching-audience, live-computed).
- **AC2 — Detail:** full content per language tab, the audience filter, timeline (created → published → retracted/expired), read count over the audience.
- **AC3 — No per-guest read list in MVP** — aggregate only (privacy-respectful default, simpler UI); noted as a possible future toggle.

---

## Story 19.4 — Guest Inbox & Bell

**As a** guest,
**I want** hotel messages in one obvious place,
**so that** I never miss "the beach bar closes early today".

### Acceptance Criteria

- **AC1 — Bell + badge:** a bell in the guest app header with an unread count, updating via the existing delta poller (one poller, another feed — the Epic 15/16 pattern). Tapping opens the inbox.
- **AC2 — Inbox:** announcements visible to this stay (filter-matched + active window), newest first, priority items pinned top with the "مهم" treatment; unread styled distinctly; opening one marks it read (per stay); the Hotel Info chip deep-links when present. Localized (guest language, EN fallback per entry); relative times localized ×7.
- **AC3 — Home surfacing:** the most recent **unread priority** announcement renders as a dismissible banner strip on home (dismiss = mark read). Non-priority items rely on the bell.
- **AC4 — States:** empty inbox gets the warm designed empty state; module off → bell absent entirely (no tile involved); checkout kills access with the session as everywhere.

---

## Implementation Notes for Claude Code

1. **Entities:** `announcements` (`hotel_id, translations JSONB {title, body}, info_entry_id?, priority, audience JSONB filter, status draft|scheduled|live|retracted|expired, publish_at, active_until?, timestamps/actors`) + `announcement_reads` (`announcement_id, stay_id, read_at` — lazy rows). Migration + module-key backfill in-PR.
2. **Visibility resolution in ONE function:** `(announcement, stay) → visible?` (filter match + window + status) — used by the guest list endpoint, the recipient count, and read-stats denominators. Filter matching covers stay_type / floor (via room) / room ids / stay id; empty filter = all.
3. **Guest endpoints:** extend `/api/guest`: `GET announcements` (visible set + unread flags, delta-cursor shaped for the shared poller), `POST announcements/:id/read`. Unread count joins the existing poll response envelope — don't add a second polling loop.
4. **Scheduling:** the hourly-jobs pattern (Epic 13's) flips `scheduled → live` and `live → expired`; hotel-local comparisons via the Intl helpers; idempotent.
5. **Live recipient count:** a tenant endpoint evaluating the filter against active stays — same visibility function, count only.
6. **Tenant UI:** announcements section (list, compose page with the audience builder + live count, detail drawer). Audience builder is the one genuinely new component — keep it composable (it will be reused if we ever target notifications elsewhere).
7. **Priority discipline:** guidance + a soft nudge (confirm dialog if >1 priority announcement live simultaneously) — pinned noise destroys the channel.
8. **Tests:** visibility matrix (filters × window × status, incl. tonight's-check-in case), retract propagation, schedule/expiry transitions + idempotency, read stats math, unread badge deltas, priority home-banner logic, seven-locale parity, module gating. Builds clean.

---

## Notes & Dependencies

- **Depends on:** Epics 13–17 machinery (stays/audience data, delta poller, translations, Hotel Info for deep-links, hourly jobs).
- **Feeds:** Epic 21 (Events) auto-announces new events through this exact pipeline; future real-push epic swaps the transport under the same inbox.
- **Deferred:** real push notifications, images, per-guest read receipts, staff-audience announcements (internal comms — Staff PWA era), templates/recurring announcements.

---

## Recorded decisions (implementation)

1. **Statuses include `draft`.** Canceling a scheduled announcement reverts it to `draft` (kept in history, editable, re-sendable) — honors the no-hard-deletes law. Compose exposes send/schedule; `draft` also exists as an explicit create action.
2. **Translations are two flat JSONB columns** (`titles` + `bodies`, each a `TranslationMap`), not the nested `{title, body}` sketch — matches every existing content entity so `localizeField` and the flat per-locale DTO convention apply unchanged. A blanked optional locale is *removed* from the map (never stored as `''`) so EN fallback keeps working.
3. **Audience dimensions AND together** and may combine (`stayTypes` + `floors` + `roomIds` — the spec's own "All-Inclusive · Floors 2–3" example); `stayId` (one guest) is exclusive with the others and must resolve to an active stay of the hotel.
4. **Local datetimes** (`publishAtLocal`, `activeUntilLocal`) are hotel-local `'YYYY-MM-DD HH:MM'` varchars, compared lexicographically against `hotelLocalStamp(tz, now)` (the `isStayOverdue` approach) — no UTC conversion anywhere. Expiry is inclusive at the minute.
5. **The transition cron runs every 5 minutes** (the Epic 13 *pattern* — thin trigger, `now`-injected idempotent method, re-entrancy flag — at a cadence that doesn't land a 09:00 notice at 10:00). The visibility function *also* enforces the active-until window, so guests never see an expired item between ticks.
6. **Guest deltas use tombstones:** rows changed since the cursor that are no longer visible return `{ id, active: false }`; the client merge drops them (how retraction propagates mid-poll). Only `live/retracted/expired` rows participate in the guest feed. `unreadCount` rides every feed response over the full visible set.
7. **Read-stats denominator** = active stays currently matching the audience filter (ignores status/window), so "قرأه 34 من 62" stays meaningful after retraction/expiry.
8. **Error codes:** `ANNOUNCEMENT_NOT_FOUND`, `ANNOUNCEMENT_TRANSLATIONS_REQUIRED`, `ANNOUNCEMENT_NOT_EDITABLE` (409), `ANNOUNCEMENT_INVALID_STATE` (409), `ANNOUNCEMENT_SCHEDULE_REQUIRED`, `ANNOUNCEMENT_SCHEDULE_IN_PAST`, `ANNOUNCEMENT_WINDOW_INVALID`, `ANNOUNCEMENT_AUDIENCE_INVALID`, `ANNOUNCEMENT_STAY_NOT_FOUND`, `ANNOUNCEMENT_INFO_ENTRY_NOT_FOUND`.
