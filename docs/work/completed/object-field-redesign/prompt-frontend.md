# Session Prompt: Object Field Reference Redesign — Frontend

## Context

You are implementing the frontend side of a breaking change to the `ObjectFieldReference` model in the Median Code frontend. The full implementation plan is at:

`docs/work/object-field-redesign/plan-frontend.md`

Also read the design spec at:

`docs/work/object-field-redesign/spec.md`

Read both before doing anything.

## Prerequisite

The backend must already have the new API deployed. The backend plan is at:

`docs/work/object-field-redesign/plan-backend.md`

Confirm the backend API returns `exposure`, `nullable`, `default` fields (not `appears`, `optional`, `serverDefault`) before starting.

## Instructions

Execute the plan task-by-task following these rules:

1. Read the full plan and spec first
2. Execute task-by-task in order — do NOT skip ahead
3. Run type check and unit tests after each task — fix failures before moving on
4. Commit after each task using the `/commit` skill (never raw `git commit`)
5. Zero failures is the only acceptable outcome
6. If a test fails, fix it before proceeding — do not accumulate debt

**REQUIRED SUB-SKILL:** Use `superpowers:executing-plans` to implement this plan.

## Scope

- **Tasks:** 10 tasks across 6 parts
- **Parts:** Types, API Client, Stores, UI Component, Tests, Final Verification
- **Estimated files:** ~8 files to create/modify

## Key Constraints

- **Working directory:** `frontend/` (symlink to the frontend repo)
- **NEVER use `rm -rf`** — use `find <dir> -delete` for directory removal (Bun hardlinks)
- **Type check after every task:** `bun run svelte-check --tsconfig ./tsconfig.json`
- **Unit tests:** `bunx vitest run`
- **Commit standard:** Conventional Commits — `feat(types): ...`, `feat(api): ...`, `feat(ui): ...`, `test(ui): ...`
- **Frontend-only scope** — do not touch `backend/`
- **Strict cleanup** — when changing a type, search the entire codebase for all usages before marking done

## Code Navigation

You have access to Serena MCP tools for semantic code analysis. PREFER these over built-in tools:
- `mcp__plugin_serena_serena__find_symbol` — find a class/function/method by name
- `mcp__plugin_serena_serena__find_referencing_symbols` — find all references to a symbol
- `mcp__plugin_serena_serena__get_symbols_overview` — understand file structure (classes, methods)
- `mcp__plugin_serena_serena__replace_symbol_body` — replace a function/method body
- `mcp__plugin_serena_serena__replace_content` — targeted regex/string replacement within files
- `mcp__plugin_serena_serena__insert_after_symbol` / `insert_before_symbol` — insert code relative to a symbol

Use Grep/Glob/Read only for non-code searches (string literals, config values, file names).
