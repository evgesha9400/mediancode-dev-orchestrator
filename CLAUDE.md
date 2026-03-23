# CLAUDE.md — Median Code Software Dev Orchestrator

## Overview

This is the software development orchestrator for Median Code. It coordinates work across the frontend and backend repos via Mission Control (a Python CLI) and scoped subagents.

- `pipelines/` — Pipeline templates (YAML)
- `docs/stages/` — Living documents for the self-improving learning system
- `frontend/` — Symlink to the frontend repo (SvelteKit)
- `backend/` — Symlink to the backend repo (FastAPI)
- `db/` — Local SQLite database for Mission Control (gitignored)

## Mission Control CLI

Mission Control is a Python CLI installed from `~/Documents/Projects/mission-control/`. Install with `cd ~/Documents/Projects/mission-control && poetry install`. The `bin/mc` wrapper handles PATH and database location — always use it instead of bare `mc`.

Key commands:
- `bin/mc pipeline create --file pipelines/software-dev.yaml`
- `bin/mc feature create --title "..." --pipeline <id>`
- `bin/mc feature get <id>`
- `bin/mc feature advance <id> [--approved]`
- `bin/mc step update <feature_id> <stage> [step] --status <status>`
- `bin/mc service register|link|status`
- `bin/mc artifact add|get`

All commands output JSON. See `bin/mc --help` for full usage.

## Cross-Repo Coordination

When working on features that span frontend and backend:
1. Query Mission Control for current feature status: `bin/mc feature get <id>`
2. Check which services are affected: `bin/mc feature get <id>` (includes services)
3. Update progress as you work: `bin/mc step update`, `bin/mc service status`
4. Read living documents before executing any stage/step
5. Write observations to living documents after completing work

## Pipeline Templates

Pipeline templates live in `pipelines/` as YAML files. See `pipelines/software-dev.yaml` for the software development pipeline.

## Living Documents

Living documents in `docs/stages/` accumulate learnings across features. Agents read them before executing and write observations after completing work.

## Banned Git Commands — MANDATORY

- **`git worktree`** — Unreliable cleanup when subagents crash (stale branches, orphaned index files, leaked directories). Blocked at the tool level via `deny` list in `.claude/settings.json` across all repos. Use feature branches instead.
- **`git filter-branch`** — Deprecated. Leaves ghost files on disk (rewrites history without issuing working-tree deletions). Use `git filter-repo` if history rewriting is absolutely necessary.

## Subagent Scoping — MANDATORY

When dispatching subagents to work on a specific repo, **always scope them explicitly**:

- **Frontend subagents**: "You are working on the frontend. Working directory: `frontend/`. Only use `fe--*` skills. Do not modify backend code."
- **Backend subagents**: "You are working on the backend. Working directory: `backend/`. Only use `be--*` skills. Do not modify frontend code."

Never dispatch two write-enabled subagents to the same repo simultaneously. The `.git` directory is shared mutable state — concurrent git operations cause index lock contention and stale index files. The pipeline handles this by scoping agents to different repos. For ad-hoc work, wait for one agent to finish before dispatching another to the same repo.

Subagents should read the target repo's own CLAUDE.md (`frontend/CLAUDE.md` or `backend/CLAUDE.md`) for full project structure details when they need deep context beyond what is summarized below.

### Serena Context for Subagents

Subagents inherit MCP server connections but NOT CLAUDE.md instructions. You MUST paste the following block into every subagent prompt that involves code exploration or modification:

```
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
```

## Observation Protocol

Observations capture learnings (problems, decisions, friction) into living documents. They work for ALL work — pipeline features, ad-hoc fixes, iteration, exploration.

### When delegating to a subagent:
1. Generate context: `bin/mc dispatch render --topic <implement|plan|explore> --service-name <svc> --agent-name <agent> --mc-path $(pwd)/bin/mc [--feature-id <id>]`
2. Paste the output block into the subagent prompt
3. After the subagent returns: `bin/mc dispatch verify <dispatch_id>`

### When working directly (no subagent):
Record observations immediately when you encounter problems, make decisions, or hit friction:
```
bin/mc observation add --topic <implement|plan|explore> --scope <fe|be|orch> --agent-name <name> --category PROBLEM|DECISION|FRICTION --title "..." --detail "..." --resolution "..." [--feature-id <id>]
```

### Consolidating:
```
bin/mc observation consolidate --output-dir pipelines/software-dev/observations/ [--feature-id <id>] [--title "..."]
```

The `bin/mc` wrapper handles PATH and database location. Never use bare `mc`.

---

## When working in frontend/

SvelteKit 5 app (Svelte 5.41+, SvelteKit 2.47+) — marketing landing page + authenticated dashboard. Uses Clerk auth, Tailwind CSS, Font Awesome, Inter font.

### Commands

```bash
cd frontend/
bun install                                        # Install dependencies
bun run dev                                        # Dev server at localhost:5173
bun run svelte-check --tsconfig ./tsconfig.json    # Type check
bunx vitest run                                    # Unit/integration tests
bunx playwright test --project=smoke               # Smoke E2E
PUBLIC_API_BASE_URL=https://api.dev.mediancode.com/v1 bunx playwright test --project=setup --project=crud  # CRUD E2E
```

### Key Rules

- **Strict Cleanup**: When deleting code, delete ALL associated files, references, imports, barrel exports. Search entire codebase with Grep before reporting done.
- **Component directories**: ONLY `.svelte` files + one `index.ts` barrel export. NEVER put `.ts` type files here.
- **Shared types**: ALL shared non-component types go in `src/lib/types/index.ts`.
- **Import from barrels**: `import { Table, Drawer } from '$lib/components'` — never import individual files.
- **No `rm -rf`**: Bun's hardlinked `node_modules` breaks `rm -rf` on macOS. Use `find <dir> -delete`. See `fe--delete-dirs` skill.
- **structuredClone fails on reactive proxies**: Use `JSON.parse(JSON.stringify(item))` instead.
- **`.svelte.ts` files**: Use `fromStore()` from `svelte/store`, NOT `$storeName` syntax.

### Git

- Main: `main` → Vercel production. Development: `develop` branch.
- Deploy: auto-deploys to Vercel on push to `main`.

---

## When working in backend/

FastAPI backend — two packages: `api_craft` (code generation library) and `api` (REST service). Python 3.13+.

### Commands

```bash
cd backend/
poetry install                    # Install dependencies
make test                         # Run all tests (mirrors CI — needs `make db` for full coverage)
make test-e2e                     # Run E2E tests only
poetry run pytest tests/test_e2e.py::TestItemsAPI::test_list_items -v  # Single test
poetry run black src/ tests/      # Format code
make clean                        # Clean caches
```

### Architecture — api_craft

```
InputAPI (JSON) → Transform → Extract → Render → Write
```

1. **Transform** (`transformers.py`): InputAPI → TemplateAPI with computed name variants
2. **Extract** (`extractors.py`): Pull models, views, path/query params
3. **Render** (`renderers.py`): Apply Mako templates
4. **Write** (`main.py`): Output project files

### Key Rules

- **Always run both test suites**: `make test` AND `make test-e2e` after any change. `make test` mirrors CI — if it warns about skipped DB tests, run `make db` first and re-run.
- **Always format after changes**: `poetry run black src/ tests/`
- **Text columns only**: Always use `Text` (never `String/VARCHAR`) in PostgreSQL.
- **No new migrations**: Modify the existing initial migration in-place during development.
- **PascalCase input names**: The `Name` type provides `.snake_name`, `.camel_name`, `.kebab_name`.
- **Junction table naming**: `applied_{thing}` for user-configured attachments, `{thing}_on_{entity}` for structural composition.

### Adding Generation Features

1. Add input fields to `api_craft/models/input.py`
2. Add template fields to `api_craft/models/template.py`
3. Update `transformers.py` → `extractors.py` → templates → `renderers.py` → `main.py`

---

## Commit Messages

All repos follow Conventional Commits: `<type>(<scope>): <subject>`

- **Orchestrator scopes**: `pipeline`, `docs`, `config`
- **Frontend scopes**: See `frontend/docs/COMMIT_MESSAGE_STANDARD.md`
- **Backend scopes**: `api`, `generation`, `models`, `config`, `deps`

Do NOT include Co-Authored-By lines (backend). Use imperative mood, lowercase, max 50 chars.
