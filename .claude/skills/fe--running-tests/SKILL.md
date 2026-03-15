---
name: fe--running-tests
description: Use when running frontend tests (unit, smoke, or CRUD E2E). Only for frontend subagents working in frontend/.
---

# Running Frontend Tests

## Scope

This skill is for **frontend subagents only**. Run all commands from `frontend/`.

## Hard Rules

1. **NEVER use `pkill -f "vite"`** — it kills the user's VS Code Vite extension and other processes.
2. **NEVER pipe test output through `tail`, `head`, or any filter** — it buffers stdout, making long-running tests appear hung with zero output.
3. **Always set a timeout** on Bash calls: 120000 for unit/smoke, 300000 for CRUD.

## Commands

```bash
cd frontend/

# Type check
bun run svelte-check --tsconfig ./tsconfig.json

# Unit/integration
bunx vitest run

# Smoke E2E
bunx playwright test --project=smoke

# CRUD E2E (requires API)
PUBLIC_API_BASE_URL=https://api.dev.mediancode.com/v1 bunx playwright test --project=setup --project=crud
```

Output goes directly to stdout. No pipes. No filters. No process killing.
