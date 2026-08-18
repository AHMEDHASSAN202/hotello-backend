# hotello-backend

Hotello (GXP) unified backend API — NestJS 10 · TypeORM · PostgreSQL.

## Running the local stack

[`scripts/dev.sh`](scripts/dev.sh) brings up everything at once: Postgres (Docker),
this API, and whichever frontends are checked out alongside this repo.

```bash
./scripts/dev.sh                 # Postgres + backend + both frontends
./scripts/dev.sh backend         # this repo only
./scripts/dev.sh --no-db         # a Postgres is already running on 5433
./scripts/dev.sh --no-migrate    # don't run migrations on boot
```

| Service | URL |
|---|---|
| Backend API | http://localhost:4000/api/v1 |
| Super Admin dashboard | http://localhost:3000 |
| Tenant dashboard | http://localhost:3001/t/`<slug>` — or `<slug>`.lvh.me:3001 |
| Postgres | `localhost:5433` (container `hotello-db`) |

It waits for the database healthcheck, applies migrations, bootstraps any missing
`.env` from `.env.example`, and prefixes each service's log lines. Ctrl+C stops
everything it started; the Postgres container is left up (`docker compose down`).

The frontends live in sibling repos (`../hotello-admin-frontend`,
`../hotello-hotel-frontend`). If they aren't checked out the script says so and
runs what it can, so a standalone clone of this repo still works.

## PDF generation

Story 11.5's print-ready QR poster and room-card PDFs (`GET
/tenant/rooms/pdf/poster`, `GET /tenant/rooms/pdf/cards`) render HTML through
a headless Chromium via [Playwright](https://playwright.dev/). Two one-time
setup steps beyond `npm install`:

```bash
npm install --cache /tmp/npm-cache playwright   # already in package.json; re-run after a fresh clone
npx playwright install chromium                 # downloads a local Chromium build (~280MB)
```

The templates embed two font families for AR/EN + Latin-script coverage —
vendored as TTFs in `assets/fonts/` (committed binaries, loaded via
`file://` URLs so rendering needs no network access):

- `NotoSans-Regular.ttf` / `NotoSans-Bold.ttf`
- `NotoKufiArabic-Regular.ttf` / `NotoKufiArabic-Bold.ttf`

Sourced from the [notofonts.github.io](https://github.com/notofonts/notofonts.github.io)
hinted static builds (`fonts/<Family>/hinted/ttf/`) — the `google/fonts` repo
only ships the variable-font source for these two families, which doesn't
carry a separate static Bold instance the way `@font-face { font-weight: 700 }`
needs. If these ever need re-vendoring, verify each download is a real TTF
(`file assets/fonts/*.ttf` → `TrueType Font data`) before committing — a
saved HTML 404 page with a `.ttf` extension is the classic failure mode.

`PdfRendererService` (`src/modules/tenant-rooms/pdf/pdf-renderer.service.ts`)
launches Chromium lazily on first use and reuses that one instance for every
render (`onModuleDestroy` closes it on shutdown) — unit tests mock this
service rather than launching a real browser.

## Database migrations

The schema is owned by **TypeORM migrations**. `synchronize` is disabled
everywhere — it can silently drop or alter columns and must never touch a real
database. Every schema change ships as a migration.

Connection settings live in one place — [`src/config/database.config.ts`](src/config/database.config.ts) —
and are shared by the app ([`src/app.module.ts`](src/app.module.ts)), the
migration CLI ([`src/data-source.ts`](src/data-source.ts)), and the seed script.
Migrations are **never** run automatically on app boot (`migrationsRun: false`);
they are applied explicitly with the command below.

The CLI data source loads all `*.entity.ts` files and all migrations in
[`src/migrations/`](src/migrations/) by glob, so new modules are picked up
automatically. Commands run through `ts-node`, so no build step is required.

### Fresh setup (new clone, empty database)

```bash
cp .env.example .env      # DB credentials + JWT secrets
docker compose up -d      # Postgres 16 on host port 5433
npm install
npm run migration:run     # 1. create the schema
npm run seed              # 2. Super Admin role + first admin + launch plans
npm run start:dev         # http://localhost:4000/api/v1
```

The order is fixed: **`migration:run` → `seed`**. Seeds insert rows and assume the
tables already exist.

### After changing an entity

Every entity change must be accompanied by a migration **in the same PR**. An
entity edit without a migration is a review failure — CI enforces it (see
[Keeping entities and migrations in sync](#keeping-entities-and-migrations-in-sync)).

```bash
# Generate a migration from the diff between entities and the current DB schema.
# Run migration:run first so you diff against the up-to-date schema.
npm run migration:run
npm run migration:generate -- src/migrations/AddGuestRequestsTable
npm run migration:run     # apply the new migration locally and verify
```

Use `migration:create` for a hand-written migration (data backfills, renames the
generator can't infer):

```bash
npm run migration:create -- src/migrations/BackfillDefaultLanguages
```

### Command reference

| Command | What it does |
| --- | --- |
| `npm run migration:run` | Apply all pending migrations. |
| `npm run migration:generate -- src/migrations/<Name>` | Generate a migration from the entity/DB diff. |
| `npm run migration:create -- src/migrations/<Name>` | Create an empty migration to hand-write. |
| `npm run migration:revert` | Revert the most recently applied migration. |
| `npm run migration:show` | List migrations and whether each is applied (`[X]`) or pending (`[ ]`). |
| `npm run migration:check` | Fail (exit 1) if entities have drifted from migrations. Requires a migrated DB. |

Migration files are timestamped (TypeORM default) so they always apply in a
deterministic order.

### Adopting the baseline on an existing database

We are **pre-production**, so the simplest path is preferred: **recreate the dev
database**. There is no production data to preserve.

```bash
docker compose down -v && docker compose up -d   # wipe the Postgres volume
npm run migration:run && npm run seed
```

If you must keep data in a dev DB whose schema already matches the baseline
(e.g. it was built by the old `synchronize`), mark the baseline as applied
**without** running it, so TypeORM records it and future migrations layer on top:

```sql
-- Connect to the database, then:
CREATE TABLE IF NOT EXISTS "migrations" (
  "id" SERIAL PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  "name" character varying NOT NULL
);
INSERT INTO "migrations" ("timestamp", "name")
VALUES (1785315376369, 'Baseline1785315376369');
```

Only do this if the existing schema genuinely matches the baseline. When in
doubt, recreate the DB — it's faster and safer at this stage.

### Keeping entities and migrations in sync

[`scripts/check-migrations.sh`](scripts/check-migrations.sh) is a lightweight CI
guard: against a throwaway Postgres it runs every migration and then
`migration:generate --check`. If an entity changed without a matching migration,
`--check` finds the drift and the script exits non-zero.

```bash
DB_NAME=hotello_ci ./scripts/check-migrations.sh
```
