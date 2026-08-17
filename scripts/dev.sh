#!/usr/bin/env bash
#
# Start the local GXP stack: Postgres + backend + whichever frontends are
# checked out next to this repo.
#
#   ./scripts/dev.sh                 Postgres + backend + both frontends
#   ./scripts/dev.sh --no-db         skip Docker/Postgres (DB running elsewhere)
#   ./scripts/dev.sh --no-migrate    skip `migration:run` on boot
#   ./scripts/dev.sh backend admin   run only the named services
#   ./scripts/dev.sh --install       npm install anywhere node_modules is missing
#
# Services:  backend  http://localhost:4000/api/v1
#            admin    http://localhost:3000
#            tenant   http://localhost:3001  (sunrise.lvh.me:3001, or
#                                             localhost:3001/t/<slug>)
#
# The frontends live in sibling repos (../hotello-admin-frontend,
# ../hotello-hotel-frontend). If they aren't checked out, this script says so
# and runs what it can — a standalone backend clone still works.
#
# Ctrl+C stops everything this script started. The Postgres container is left
# running on purpose — `docker compose down` stops it.

set -uo pipefail

# Resolve through symlinks so the workspace-root shortcut works too.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  LINK_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$LINK_DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

BACKEND="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="$(cd "$BACKEND/.." && pwd)"
ADMIN="$WORKSPACE/hotello-admin-frontend"
TENANT="$WORKSPACE/hotello-hotel-frontend"

# npm's shared cache has root-owned entries on some machines; a local cache dir
# keeps `npm install` from failing with EACCES.
NPM_CACHE="${TMPDIR:-/tmp}/npm-cache-hotello"

C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_MAGENTA=$'\033[35m'

info()  { printf '%s==>%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf '%s ok %s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()   { printf '%sfail%s %s\n' "$C_RED"    "$C_RESET" "$*" >&2; exit 1; }

RUN_DB=1 RUN_MIGRATE=1 DO_INSTALL=0 EXPLICIT=0
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --no-db)      RUN_DB=0 ;;
    --no-migrate) RUN_MIGRATE=0 ;;
    --install)    DO_INSTALL=1 ;;
    -h|--help)    awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$SOURCE"; exit 0 ;;
    backend|admin|tenant) SERVICES+=("$arg"); EXPLICIT=1 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done
[[ ${#SERVICES[@]} -eq 0 ]] && SERVICES=(backend admin tenant)

wants() { [[ " ${SERVICES[*]} " == *" $1 "* ]]; }

drop_service() { # remove $1 from SERVICES
  local keep=() s
  for s in "${SERVICES[@]}"; do [[ "$s" != "$1" ]] && keep+=("$s"); done
  SERVICES=("${keep[@]+"${keep[@]}"}")
}

# A sibling repo that isn't checked out is fatal only if it was asked for by
# name; otherwise it's skipped so a standalone backend clone still runs.
require_repo() { # $1 dir, $2 service, $3 repo name
  [[ -d "$1" ]] && return 0
  if [[ $EXPLICIT -eq 1 ]]; then
    die "$3 not found at $1 — clone it next to hotello-backend"
  fi
  warn "$3 not checked out — skipping '$2' (expected at $1)"
  drop_service "$2"
  return 1
}

# ----------------------------------------------------------------- teardown

PIDS=()

kill_tree() { # npm spawns nest/next as children — kill the whole subtree
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

cleanup() {
  trap - INT TERM EXIT
  # Nothing started yet (preflight failure) — exit quietly.
  [[ ${#PIDS[@]} -eq 0 ]] && return 0
  printf '\n'
  info "stopping services…"
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && kill_tree "$pid"
  done
  wait 2>/dev/null
  ok "stopped. Postgres is still up — 'docker compose down' in $(basename "$BACKEND")/ stops it."
}
trap cleanup INT TERM EXIT

# ------------------------------------------------------------ preflight

check_port() { # $1 port, $2 service label
  if lsof -ti:"$1" >/dev/null 2>&1; then
    warn "port $1 ($2) is already in use — that service may fail to start."
    printf '%s     free it with: lsof -ti:%s | xargs kill%s\n' "$C_DIM" "$1" "$C_RESET"
  fi
}

ensure_env() { # $1 dir, $2 target env filename
  local dir=$1 target=$2
  [[ -f "$dir/$target" ]] && return 0
  if [[ -f "$dir/.env.example" ]]; then
    cp "$dir/.env.example" "$dir/$target"
    ok "created $(basename "$dir")/$target from .env.example"
  else
    warn "$(basename "$dir") has no $target and no .env.example"
  fi
}

ensure_deps() { # $1 dir
  local dir=$1
  if [[ ! -d "$dir/node_modules" || $DO_INSTALL -eq 1 ]]; then
    info "npm install — $(basename "$dir") (first run, this takes a minute)"
    (cd "$dir" && npm install --cache "$NPM_CACHE" --no-fund --no-audit) \
      || die "npm install failed in $(basename "$dir")"
  fi
}

start_db() {
  if ! docker info >/dev/null 2>&1; then
    if [[ "$(uname)" == "Darwin" && -d /Applications/Docker.app ]]; then
      info "starting Docker Desktop…"
      open -a Docker
      for _ in $(seq 30); do
        docker info >/dev/null 2>&1 && break
        sleep 2
      done
    fi
    docker info >/dev/null 2>&1 || die "Docker daemon is not running (start Docker Desktop, or use --no-db)"
  fi

  info "starting Postgres (hotello-db, host port 5433)…"
  (cd "$BACKEND" && docker compose up -d) >/dev/null 2>&1 \
    || die "docker compose up failed — run it in $(basename "$BACKEND")/ to see why"

  # docker-compose.yml defines a pg_isready healthcheck; wait for it.
  for _ in $(seq 45); do
    case "$(docker inspect -f '{{.State.Health.Status}}' hotello-db 2>/dev/null)" in
      healthy)   ok "Postgres healthy"; return 0 ;;
      unhealthy) die "hotello-db reports unhealthy — check 'docker logs hotello-db'" ;;
    esac
    sleep 1
  done
  die "timed out waiting for Postgres to become healthy"
}

# ------------------------------------------------------------------ boot

wants admin  && require_repo "$ADMIN"  admin  "hotello-admin-frontend"
wants tenant && require_repo "$TENANT" tenant "hotello-hotel-frontend"
[[ ${#SERVICES[@]} -eq 0 ]] && die "nothing to run"

printf '%s\n' "${C_DIM}GXP local stack — ${SERVICES[*]}${C_RESET}"

if wants backend; then
  ensure_env "$BACKEND" ".env"
  ensure_deps "$BACKEND"
  check_port 4000 backend

  if [[ $RUN_DB -eq 1 ]]; then
    start_db
    if [[ $RUN_MIGRATE -eq 1 ]]; then
      info "running migrations…"
      MIGRATE_LOG="${TMPDIR:-/tmp}/gxp-migrate.log"
      if (cd "$BACKEND" && npm run migration:run) >"$MIGRATE_LOG" 2>&1; then
        ok "schema up to date"
      else
        warn "migration:run failed — see $MIGRATE_LOG (continuing)"
      fi
    fi
  else
    warn "skipping Docker/Postgres (--no-db) — backend needs a DB on port 5433"
  fi
fi

if wants admin; then
  ensure_env "$ADMIN" ".env.local"
  ensure_deps "$ADMIN"
  check_port 3000 admin
fi

if wants tenant; then
  ensure_env "$TENANT" ".env.local"
  ensure_deps "$TENANT"
  check_port 3001 tenant
fi

# Each service's output is prefixed and line-flushed so the merged stream stays
# readable. awk (not sed -u/-l) keeps this portable across BSD and GNU.
run_service() { # $1 label, $2 color, $3 dir, $4... command
  local label=$1 color=$2 dir=$3; shift 3
  ( cd "$dir" && "$@" 2>&1 \
      | awk -v p="${color}[${label}]${C_RESET} " '{print p $0; fflush()}' ) &
  PIDS+=($!)
}

wants backend && run_service backend "$C_GREEN"   "$BACKEND" npm run start:dev
wants admin   && run_service admin   "$C_MAGENTA" "$ADMIN"   npm run dev
wants tenant  && run_service tenant  "$C_BLUE"    "$TENANT"  npm run dev

printf '\n'
wants backend && ok "backend  → http://localhost:4000/api/v1"
wants admin   && ok "admin    → http://localhost:3000"
wants tenant  && ok "tenant   → http://localhost:3001/t/<slug>  (or <slug>.lvh.me:3001)"
printf '%sCtrl+C to stop everything.%s\n\n' "$C_DIM" "$C_RESET"

wait
