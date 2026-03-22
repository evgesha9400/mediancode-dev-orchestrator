# Session Prompt: Object Field Reference Redesign — Backend

## Context

You are implementing a breaking change to the `ObjectFieldReference` model in the Median Code backend. The full implementation plan is at:

`docs/work/object-field-redesign/plan-backend.md`

Also read the design spec at:

`docs/work/object-field-redesign/spec.md`

Read both before doing anything.

## Instructions

Execute the plan task-by-task following these rules:

1. Read the full plan and spec first
2. Execute task-by-task in order — do NOT skip ahead
3. Run tests after each task — fix failures before moving on
4. Commit after each task using the `/commit` skill (never raw `git commit`)
5. Zero failures is the only acceptable outcome
6. If a test fails, fix it before proceeding — do not accumulate debt

**REQUIRED SUB-SKILL:** Use `superpowers:executing-plans` to implement this plan.

## Scope

- **Tasks:** 11 tasks across 6 parts
- **Parts:** Enums & Input Model, API Schemas / DB / Migration, Seeding, Generation Engine, Tests, Final Verification
- **Estimated files:** ~15 files to create/modify

## Key Constraints

- **Working directory:** `backend/` (symlink to the backend repo)
- **No new migration files** — modify `src/api/migrations/versions/4141ad7f2255_initial_schema.py` in-place
- **Always format:** `poetry run black src/ tests/` after every change
- **Test commands:** `make test` (unit) and `make test-e2e` (E2E) — both must pass
- **Commit standard:** Conventional Commits — `feat(api): ...`, `feat(generation): ...`, `test(api): ...`
- **Backend-only scope** — do not touch `frontend/`

## Code Navigation

You have access to Serena MCP tools for semantic code analysis. PREFER these over built-in tools:
- `mcp__plugin_serena_serena__find_symbol` — find a class/function/method by name
- `mcp__plugin_serena_serena__find_referencing_symbols` — find all references to a symbol
- `mcp__plugin_serena_serena__get_symbols_overview` — understand file structure (classes, methods)
- `mcp__plugin_serena_serena__replace_symbol_body` — replace a function/method body
- `mcp__plugin_serena_serena__replace_content` — targeted regex/string replacement within files
- `mcp__plugin_serena_serena__insert_after_symbol` / `insert_before_symbol` — insert code relative to a symbol

Use Grep/Glob/Read only for non-code searches (string literals, config values, file names).
