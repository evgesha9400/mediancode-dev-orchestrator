# CLAUDE.md — Median Code Software Dev Orchestrator

## Overview

This is the software development orchestrator for Median Code. It coordinates work across the frontend and backend repos via Mission Control (a Python CLI) and scoped subagents.

- `pipelines/` — Pipeline templates (YAML)
- `docs/stages/` — Living documents for the self-improving learning system
- `frontend/` — Symlink to the frontend repo (SvelteKit)
- `backend/` — Symlink to the backend repo (FastAPI)
- `db/` — Local SQLite database for Mission Control (gitignored)

## Mission Control CLI

Mission Control is a Python CLI installed from `~/Documents/Projects/mission-control/`. Install with `cd ~/Documents/Projects/mission-control && poetry install`. The `mc` command uses a local `./db/mission-control.db` database (set via `MC_DB` env var).

Key commands:
- `mc pipeline create --file pipelines/software-dev.yaml`
- `mc feature create --title "..." --pipeline <id>`
- `mc feature get <id>`
- `mc feature advance <id> [--approved]`
- `mc step update <feature_id> <stage> [step] --status <status>`
- `mc service register|link|status`
- `mc artifact add|get`

All commands output JSON. See `mc --help` for full usage.

## Cross-Repo Coordination

When working on features that span frontend and backend:
1. Query Mission Control for current feature status: `mc feature get <id>`
2. Check which services are affected: `mc feature get <id>` (includes services)
3. Update progress as you work: `mc step update`, `mc service status`
4. Read living documents before executing any stage/step
5. Write observations to living documents after completing work

## Pipeline Templates

Pipeline templates live in `pipelines/` as YAML files. See `pipelines/software-dev.yaml` for the software development pipeline.

## Living Documents

Living documents in `docs/stages/` accumulate learnings across features. Agents read them before executing and write observations after completing work.

## Subagent Scoping — MANDATORY

When dispatching subagents to work on a specific repo, **always scope them explicitly**:

- **Frontend subagents**: "You are working on the frontend. Working directory: `frontend/`. Only use `fe--*` skills. Do not modify backend code."
- **Backend subagents**: "You are working on the backend. Working directory: `backend/`. Only use `be--*` skills. Do not modify frontend code."

Subagents should read the target repo's own CLAUDE.md (`frontend/CLAUDE.md` or `backend/CLAUDE.md`) for full project structure details when they need deep context beyond what is summarized below.

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
- **No worktrees**: Bun's hardlinked `node_modules` makes worktree cleanup hang on macOS. Use feature branches.
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
make test                         # Run unit tests
make test-e2e                     # Run E2E tests
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

- **Always run both test suites**: `make test` AND `make test-e2e` after any change.
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
