# Session Prompt: Relationship Field Fixes — Backend

## Context

You are fixing four bugs in the code generation pipeline related to relationship FK fields. The full implementation plan is at:

`/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/docs/work/relationship-field-fixes/plan-backend.md`

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

- **Tasks**: 8 tasks across 4 parts
- **Parts**: ConfigDict fix, FK in Create/Update, FK type derivation, Final verification
- **Estimated files**: 3 files to modify (`schema_splitter.py`, `prepare.py`, `models.mako`), 1 test file to update

## Key Constraints

- Working directory: `backend/`
- Test command: `cd backend && make test`
- E2E test command: `cd backend && make test-e2e`
- Format command: `cd backend && poetry run black src/ tests/`
- Always run both test suites in final verification
- Python 3.13+, Pydantic v2
