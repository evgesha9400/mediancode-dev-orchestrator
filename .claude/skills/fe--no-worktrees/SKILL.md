---
name: fe--no-worktrees
description: OVERRIDES worktree skills for frontend — bun hardlinks make worktree cleanup hang on macOS. Use feature branches instead.
---

# Frontend: Feature Branch Workflow (No Worktrees)

## Scope

This skill is for **frontend subagents only**. It overrides any worktree-related skills.

## Why No Worktrees

The frontend uses bun, which creates hardlinked `node_modules` with 65535+ links per directory. On macOS APFS, deleting these hangs indefinitely — `rm -rf`, `rsync --delete`, and `git worktree remove` all fail. Worktrees are banned for the frontend repo.

## Workflow

```bash
cd frontend/

# Start feature
git checkout -b feat/<feature-name>

# Work normally, commit with /commit skill

# Finish
git checkout develop
git merge feat/<feature-name>
git branch -d feat/<feature-name>
```

No `bun install` needed (same `node_modules`). No `.env` copy. No `svelte-kit sync`. Instant cleanup.
