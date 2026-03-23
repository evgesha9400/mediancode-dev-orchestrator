# Session Prompt: FK Field Auto-Creation — Frontend

## Context

You are updating the frontend to display auto-created FK fields with the new `fk` role. The backend now auto-creates FK fields when `references` relationships are created. The full implementation plan is at:

`/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/docs/work/fk-field-auto-creation/plan-frontend.md`

Read the plan before doing anything.

## Instructions

Execute the plan task-by-task following these rules:

1. Read the full plan first
2. Execute task-by-task in order — do NOT skip ahead
3. Run tests after each task — fix failures before moving on
4. Commit after each task with the commit message specified in the plan
5. Zero failures is the only acceptable outcome
6. If a test fails, fix it before proceeding — do not accumulate debt

**REQUIRED SUB-SKILL:** Use autonomous-executing-plans to implement this plan.

## Branch Policy — MANDATORY

**Do NOT create a new branch. Do NOT run `git checkout -b`, `git switch -c`, or any branch-creation command.**

Commit directly to the current branch. The orchestrator manages branching — subagents never create branches.

## Code Navigation Tools

You have access to Serena MCP tools for semantic code analysis. PREFER these over built-in tools:
- `mcp__plugin_serena_serena__find_symbol` — find a class/function/method by name
- `mcp__plugin_serena_serena__find_referencing_symbols` — find all references to a symbol
- `mcp__plugin_serena_serena__get_symbols_overview` — understand file structure (classes, methods)
- `mcp__plugin_serena_serena__replace_symbol_body` — replace a function/method body
- `mcp__plugin_serena_serena__replace_content` — targeted regex/string replacement within files
- `mcp__plugin_serena_serena__insert_after_symbol` / `insert_before_symbol` — insert code relative to a symbol
Use Grep/Glob/Read only for non-code searches (string literals, config values, file names).
Decision rule: if the target is a code symbol, use Serena. If it is a text string, use Grep.

## Scope

- **Tasks**: 7 tasks across 5 parts
- **Parts**: Type system updates, Locked FK field rows, Preview cleanup, Tests, Final verification
- **Estimated files**: 4-5 files to modify (`types/index.ts`, `api/objects.ts`, `ObjectFormContent.svelte`, `FieldSelectorDropdown.svelte`, `examples.ts`), test files

## Key Constraints

- Working directory: `frontend/` (absolute: `/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend/`)
- Unit test command: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend && bunx vitest run`
- Type check command: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend && bun run svelte-check --tsconfig ./tsconfig.json`
- SvelteKit 5, Svelte 5.41+, TypeScript
- **NEVER use `rm -rf`** — bun hardlinks break it on macOS. Use `find <dir> -delete` instead.
- Use `$lib/` path alias for imports
- Use the /commit skill for all commits
