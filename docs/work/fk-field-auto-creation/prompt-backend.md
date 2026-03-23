# Session Prompt: FK Field Auto-Creation — Backend

## Context

You are implementing automatic FK field creation in the relationship service. When a `references` relationship is created, the service auto-creates a real FK field (`customer_id`) with role `fk`. The full implementation plan is at:

`/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/docs/work/fk-field-auto-creation/plan-backend.md`

Read the plan before doing anything.

## Instructions

Execute the plan task-by-task following these rules:

1. Read the full plan first
2. Execute task-by-task in order — do NOT skip ahead
3. Run tests after each task — fix failures before moving on
4. Commit after each task with the commit message specified in the plan
5. Zero failures is the only acceptable outcome
6. If a test fails, fix it before proceeding — do not accumulate debt

**REQUIRED SUB-SKILL:** Use superpowers:executing-plans to implement this plan.

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

- **Tasks**: 9 tasks across 5 parts
- **Parts**: FieldRole enum, fk_field_id column, FK auto-creation logic, Tests, Final verification
- **Estimated files**: 5 files to modify (`enums.py`, `database.py`, `generation.py`, `literals.py`, `relationship.py`), 1 schema file (`relationship.py`), 1 test file to create/update

## Key Constraints

- Working directory: `backend/` (absolute: `/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend/`)
- Test command: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && make test`
- E2E test command: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && make test-e2e`
- Format command: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && poetry run black src/ tests/`
- Always run both test suites in final verification
- Python 3.13+, SQLAlchemy 2.x (async), Pydantic v2
- Modify the existing initial migration in-place — do NOT create new migration files
- Use the /commit skill for all commits
