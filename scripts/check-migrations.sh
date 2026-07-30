#!/usr/bin/env bash
#
# CI guard: fails if entities and migrations are out of sync.
#
# The rule (see README → Database migrations): every schema change ships with a
# migration in the same PR. This script enforces it — if someone edits an
# entity but forgets to generate a migration, `migration:generate --check`
# detects the drift and exits non-zero.
#
# Requires a reachable Postgres (DB_* env vars, same as the app). In CI: start a
# throwaway Postgres, point DB_* at it, then run this script. It:
#   1. applies all migrations to the (empty) database, then
#   2. checks that the resulting schema matches the entities exactly.
#
# Usage:  DB_NAME=hotello_ci ./scripts/check-migrations.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Applying migrations…"
npm run migration:run --silent

echo "→ Checking entities are in sync with migrations…"
if npm run migration:check --silent; then
  echo "✓ Entities and migrations are in sync."
else
  echo "✗ Entities have drifted from migrations."
  echo "  An entity changed without a matching migration. Run:"
  echo "      npm run migration:generate -- src/migrations/<DescriptiveName>"
  echo "  and commit the generated file in the same PR."
  exit 1
fi
