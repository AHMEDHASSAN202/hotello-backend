#!/usr/bin/env bash
# Commit all pending changes in every GXP sub-repo (the workspace root is
# not a git repository — each subproject has its own).
#
# Usage:
#   ./commit-all.sh                       # commit to master, auto message
#   ./commit-all.sh feature/x             # commit to feature/x (created if missing)
#   ./commit-all.sh master "fix: typo"    # commit to master with a fixed message
#
#   $1  branch  (optional, default: master; created from current HEAD if missing)
#   $2  message (optional, default: generated from the changed paths)

set -euo pipefail

BRANCH="${1:-master}"
MESSAGE="${2:-}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPOS=(gxp-backend gxp-admin-frontend gxp-hotel-frontend)

for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  if [ ! -d "$dir/.git" ]; then
    echo "-- $repo: not a git repository, skipping"
    continue
  fi

  if [ -z "$(git -C "$dir" status --porcelain)" ]; then
    echo "-- $repo: clean, nothing to commit"
    continue
  fi

  current="$(git -C "$dir" branch --show-current)"
  if [ "$current" != "$BRANCH" ]; then
    if git -C "$dir" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
      git -C "$dir" checkout "$BRANCH"
    else
      git -C "$dir" checkout -b "$BRANCH"
    fi
  fi

  git -C "$dir" add -A

  msg="$MESSAGE"
  if [ -z "$msg" ]; then
    # Auto message: the touched areas (module under src/, else top folder)
    # plus the file count, e.g. "chore: update migrations, modules (10 files)".
    scopes="$(git -C "$dir" diff --cached --name-only \
      | awk -F/ '{ if ($1 == "src" && NF > 1) print $2; else print $1 }' \
      | sort -u | paste -sd ', ' -)"
    count="$(git -C "$dir" diff --cached --name-only | wc -l | tr -d ' ')"
    msg="chore: update ${scopes} (${count} files)"
  fi

  git -C "$dir" commit -m "$msg"
  echo "== $repo: committed $(git -C "$dir" rev-parse --short HEAD) to $BRANCH — $msg"
done
