# Task — Migration Infrastructure Setup (TypeORM)

> **Type:** Technical task (not a feature epic). Hand this file to Claude Code as-is.
>
> **Context:** The backend currently runs TypeORM with `synchronize: true` and has no migration infrastructure. This was a deliberate early-development choice. This task switches the project to proper migrations **before production** — `synchronize` can silently drop/alter columns on entity changes and must never reach a real environment.
>
> **When to run this task:** After Epic 06 (Notifications) and Epic 07 (Admin Localization) are implemented, so the baseline migration captures the complete Super Admin schema. It must be done **before** starting the Tenant Dashboard backend.

## Goal

Replace `synchronize: true` with a full TypeORM migrations workflow: config, scripts, a baseline migration reflecting the current schema, and documentation of the day-to-day workflow.

## Requirements

1. **Data source config:** Create a CLI-compatible TypeORM data source file (e.g., `src/data-source.ts`) reading the same env vars the app uses (single source of truth — no duplicated DB config). It must load all entities and point to a migrations directory (e.g., `src/migrations/`).
2. **Turn off synchronize:** Set `synchronize: false` everywhere (app config included). Add `migrationsRun` behavior decision: migrations run via explicit command, **not** automatically on app boot (safer; documented in the workflow).
3. **npm scripts:** Add scripts for: `migration:generate` (diff against entities), `migration:create` (empty), `migration:run`, `migration:revert`, `migration:show`. All must work with the TypeScript data source (ts-node or compiled — pick what fits the project setup and document it).
4. **Baseline migration:** Generate one baseline migration from the current entities capturing the entire existing schema (admins, roles/permissions, plans, subscriptions, hotels, tenant_users, setup tokens, notifications outbox, audit — everything present). Verify it runs cleanly on an **empty** database and produces a schema identical to what `synchronize` produced.
5. **Existing databases path:** Document (in the README section below) how an existing dev database adopts the baseline without recreating data: run against a fresh DB when possible; otherwise mark the baseline as applied using TypeORM's migrations table. Keep it simple — we are pre-production; recreating dev DBs is acceptable, say so explicitly.
6. **Seeds compatibility:** Ensure existing seeds (Standard + Free Trial plans, permission catalog, initial Super Admin) run correctly after migrations on a fresh DB. Document the fresh-setup order: `migration:run` → seeds.
7. **README/docs:** Add a short "Database migrations" section to the project docs: fresh setup, generating a migration after entity changes, running, reverting, and the rule that **every schema change from now on ships with a migration in the same PR** — entity edits without a migration are a build-review failure.
8. **CI/verification hook (lightweight):** Add a check (script is enough) that fails if entities and migrations are out of sync (`migration:generate` producing a non-empty diff means someone forgot a migration).

## Acceptance Criteria

- **AC1:** Fresh clone + empty DB: `migration:run` then seeds produce a fully working app (login, all modules functional). No `synchronize` anywhere.
- **AC2:** `migration:generate` on the clean state produces an empty diff (entities and baseline are in sync).
- **AC3:** `migration:revert` cleanly reverts the baseline on a scratch DB.
- **AC4:** All existing unit tests pass and the TypeScript build is clean.
- **AC5:** Docs section exists and matches reality (commands copy-paste-able).

## Notes

- Do not refactor entities as part of this task — pure infrastructure. If you find schema issues worth fixing, list them at the end of your report; don't fix them here.
- Keep migration file naming timestamped (TypeORM default) for deterministic ordering.
