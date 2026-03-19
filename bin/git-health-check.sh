#!/bin/bash
# Reports git health issues without modifying anything.
# Usage: bin/git-health-check.sh [repo_path ...]
# If no paths given, checks frontend/ and backend/ relative to script location.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPOS=("$@")
if [ ${#REPOS[@]} -eq 0 ]; then
  REPOS=("$SCRIPT_DIR/frontend" "$SCRIPT_DIR/backend")
fi

TOTAL_ISSUES=0

for REPO in "${REPOS[@]}"; do
  [ ! -d "$REPO/.git" ] && [ ! -f "$REPO/.git" ] && continue
  REPO_NAME="$(basename "$REPO")"
  ISSUES=0

  # Stale alternate index files (.git/index 2, etc.)
  for f in "$REPO/.git/index"\ *; do
    if [ -f "$f" ]; then
      echo "WARNING [$REPO_NAME]: Stale index file: $(basename "$f")"
      ISSUES=$((ISSUES+1))
    fi
  done

  # Stale index.lock
  if [ -f "$REPO/.git/index.lock" ]; then
    echo "WARNING [$REPO_NAME]: Stale index.lock file"
    ISSUES=$((ISSUES+1))
  fi

  # Orphaned worktrees
  ORPHANS=$(git -C "$REPO" worktree list --porcelain 2>/dev/null | grep -c "prunable")
  if [ "$ORPHANS" -gt 0 ]; then
    echo "WARNING [$REPO_NAME]: $ORPHANS orphaned worktree(s)"
    ISSUES=$((ISSUES+1))
  fi

  # Stale worktree branches (feat-*-XXXXX pattern from old worktree usage)
  STALE_BRANCHES=$(git -C "$REPO" branch --list 'feat-*-?????' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$STALE_BRANCHES" -gt 0 ]; then
    echo "WARNING [$REPO_NAME]: $STALE_BRANCHES stale worktree-style branch(es)"
    ISSUES=$((ISSUES+1))
  fi

  # filter-branch backup refs
  if git -C "$REPO" show-ref --quiet refs/original/ 2>/dev/null; then
    echo "WARNING [$REPO_NAME]: filter-branch backup refs exist (refs/original/)"
    ISSUES=$((ISSUES+1))
  fi

  if [ "$ISSUES" -eq 0 ]; then
    echo "OK [$REPO_NAME]: No git health issues"
  fi
  TOTAL_ISSUES=$((TOTAL_ISSUES+ISSUES))
done

exit $TOTAL_ISSUES
