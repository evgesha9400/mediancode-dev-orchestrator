# Median Project Reorganization — Specification

## Goal

Reorganize all Median Code project files — currently scattered across 5 locations — and extract Mission Control as a standalone project. The new structure must:

1. **Extract Mission Control** as an independent, reusable project at the same level as Median — it is domain-agnostic and not owned by Median Code
2. **Consolidate Median Code** into a single root directory (`mediancode/`) with clear separation of git repos, orchestrators, and domain folders
3. **Support a master orchestrator** that oversees all domains (software, business, marketing, etc.)
4. **Apply consistent naming** — all repos use the `mediancode-` prefix (no hyphen in "mediancode")

## Current State

All paths are under `~/Documents/Projects/`.

### Active code repositories (git repos)

| Current Path | Description |
|---|---|
| `median-code-frontend/` | SvelteKit 5 app — marketing landing + authenticated dashboard. Uses Clerk auth, Tailwind, Font Awesome. Has CLAUDE.md, .claude/ with skills, memory, and project settings at `~/.claude/projects/-Users-evgesha-Documents-Projects-median-code-frontend/` |
| `median-code-backend/` | FastAPI backend — REST API with Clerk JWT auth. Has its own CLAUDE.md and project settings at `~/.claude/projects/-Users-evgesha-Documents-Projects-median-code-backend/` |

### Software orchestrator (git repo, just created)

| Current Path | Description |
|---|---|
| `median-code/` | Orchestration repo created 2026-03-15. Contains `mission-control/` MCP server (Node.js, SQLite, 50 tests) **nested inside**, `pipelines/software-dev.yaml`, `docs/stages/` living documents, `.mcp.json` for Claude Code MCP registration, `.claude/skills/dispatch-pipeline/`. Has symlinks: `frontend/ → median-code-frontend`, `backend/ → median-code-backend`. 14 git commits. |

### VS Code workspace file

| Current Path | Description |
|---|---|
| `median-code.code-workspace` | Multi-root workspace with 3 folders (median-code, median-code-frontend, median-code-backend), settings, and tasks (Claude: Orchestrator, Claude: Frontend, Claude: Frontend 2, Claude: Backend, Claude: Backend 2, Terminal: Frontend, Terminal: Backend, plus compound tasks). |

### Business & design files (not git repos)

| Current Path | Description |
|---|---|
| `MedianCode/` | Catch-all folder with mixed content from 2023-2024 |
| `MedianCode/business plan/` | 7 business plan templates and guides (PDFs, DOCs) including Innovator Visa guides |
| `MedianCode/RMA Business Plan Questionnaire.docx` | Business plan questionnaire |
| `MedianCode/color palette/` | Brand color palette (.ase, .swatches, .png files) |
| `MedianCode/templates/` | Nearly empty, has an `API/` subdir — will be deleted |

### Old code prototypes (git repos, inactive since 2025)

| Current Path | Description |
|---|---|
| `MedianCode/api-craft/` | Old code generation tool (Python, Poetry) — no longer active |
| `MedianCode/fastapi_craft/` | Old FastAPI code gen prototype |
| `MedianCode/template_api/` | Old API template prototype |
| `MedianCode/template_fastapi/` | Old FastAPI template prototype |
| `MedianCode/template_api.zip` | Archived copy of template_api |

### Mission Control MCP server (currently nested)

| Current Path | Description |
|---|---|
| `median-code/mission-control/` | Domain-agnostic pipeline orchestration MCP server. Node.js + TypeScript + SQLite. 23 MCP tools, 50 tests passing, 10 source files. **Designed to be extractable** — zero coupling to Median Code. Currently nested inside the software orchestrator but should be its own project. |

## Target Structure

### Two independent projects at `~/Documents/Projects/`

```
~/Documents/Projects/
│
├── mission-control/                            # Standalone tool (its own project)
│   ├── mission-control.code-workspace          # VS Code workspace
│   ├── repos/
│   │   └── server/                             # MCP server npm package (git repo)
│   │       ├── src/                            #   10 source files
│   │       ├── tests/                          #   8 test files, 50 tests
│   │       ├── dist/                           #   compiled output
│   │       ├── db/                             #   SQLite databases (gitignored)
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       └── vitest.config.ts
│   ├── docs/                                   # Documentation, design specs
│   ├── business/                               # Future: business docs for MC as a product
│   └── design/                                 # Future: branding if MC becomes a product
│
├── mediancode/                                 # Median Code project
│   ├── mediancode.code-workspace               # VS Code multi-root workspace
│   │
│   │ ── Git Repositories ────────────────
│   ├── repos/
│   │   │
│   │   │ ── Orchestrators ───────────────
│   │   ├── mediancode-master-orchestrator/     # Master orchestrator (future)
│   │   │   ├── CLAUDE.md                       #   oversees all domains
│   │   │   ├── .mcp.json                       #   → /Users/evgesha/.../mission-control/repos/server/dist/
│   │   │   └── pipelines/                      #   cross-domain pipeline templates
│   │   │
│   │   ├── mediancode-dev-orchestrator/        # Software dev orchestrator (was median-code/)
│   │   │   ├── CLAUDE.md
│   │   │   ├── .mcp.json                       #   → /Users/evgesha/.../mission-control/repos/server/dist/
│   │   │   ├── .claude/skills/
│   │   │   ├── pipelines/                      #   software-dev.yaml
│   │   │   ├── docs/stages/                    #   living documents
│   │   │   ├── db/                             #   local SQLite (gitignored)
│   │   │   ├── frontend → ../median-code-frontend
│   │   │   └── backend → ../median-code-backend
│   │   │
│   │   │ ── Code Repositories ───────────
│   │   ├── median-code-frontend/               # SvelteKit app (keeps current name for now)
│   │   └── median-code-backend/                # FastAPI API (keeps current name for now)
│   │
│   │ ── Domain Folders (not git repos) ──
│   ├── business/
│   │   ├── plans/                              #   was MedianCode/business plan/
│   │   └── questionnaires/                     #   RMA questionnaire
│   │
│   ├── design/
│   │   └── brand/                              #   was MedianCode/color palette/
│   │
│   ├── finance/                                # Future
│   ├── legal/                                  # Future
│   ├── marketing/                              # Future
│   │
│   │ ── Archive ─────────────────────────
│   └── archive/
│       ├── api-craft/                          #   was MedianCode/api-craft/
│       ├── fastapi-craft/                      #   was MedianCode/fastapi_craft/
│       ├── template-api/                       #   was MedianCode/template_api/
│       ├── template-api.zip                    #   was MedianCode/template_api.zip
│       └── template-fastapi/                   #   was MedianCode/template_fastapi/
```

### Future: Rename code repos to `mediancode-*`

The code repos currently use `median-code-frontend` and `median-code-backend` (hyphenated). A follow-up task should rename them to match the `mediancode-` prefix used by orchestrators:

- `median-code-frontend/` → `mediancode-frontend/`
- `median-code-backend/` → `mediancode-backend/`

This involves: renaming GitHub repos, updating git remotes, updating Claude Code project settings paths, updating all internal references (CLAUDE.md, test configs, CI). Not done during the initial migration to keep scope manageable.

### Key architectural decisions

**Mission Control is extracted.** It has zero coupling to Median Code — no hardcoded paths, no Median-specific logic. Extracting it means:

- **Own project root** at `~/Documents/Projects/mission-control/` with `repos/server/` for the git repo
- **Own VS Code workspace** and potential organizational structure (mirroring the Median pattern)
- **Orchestrators reference it externally** via absolute path in `.mcp.json`
- **Each orchestrator gets its own SQLite database** — `MISSION_CONTROL_DB` env var points to a local `db/` directory within the orchestrator
- **`mission-control/` is removed from the orchestrator repo** — it no longer lives inside it

**All git repos live under `repos/`.** This cleanly separates version-controlled code from unversioned domain folders (business, design, etc.). Orchestrators and code repos are siblings — orchestrator symlinks use simple `../median-code-frontend` paths.

**Orchestrators use `mediancode-<domain>-orchestrator` naming.** This is explicit and unambiguous in any IDE project picker, terminal, or file browser. No confusion between orchestrators and code repos.

### Naming conventions

- **Kebab-case everywhere** — no spaces, no underscores, no PascalCase in directory names
- **`mediancode-<domain>-orchestrator`** — explicit naming for orchestrators
- **`mediancode-<role>`** — for code repos (future, after rename)
- **Domain folders** (business, design, finance) are plain directories, not git repos

### Orchestrator convention

Each domain can have its own orchestrator when needed:
- `mediancode-dev-orchestrator/` — manages frontend and backend repos
- `mediancode-marketing-orchestrator/` — would manage marketing campaigns, content pipelines
- `mediancode-master-orchestrator/` — the master, coordinates cross-domain work

Each orchestrator is an independent git repo containing:
- `CLAUDE.md` with domain-specific instructions
- `.mcp.json` pointing to the shared Mission Control server with a local DB path
- `pipelines/` — YAML pipeline templates for that domain
- `docs/stages/` — living documents for that domain's learning system
- Symlinks to the repos/resources it manages

Orchestrators do NOT contain their own copy of Mission Control. They all share the single extracted `mission-control/repos/server/` binary, each with their own SQLite database.

### Database isolation

Each orchestrator runs its own SQLite database, so domains are completely independent:
```json
// mediancode/repos/mediancode-dev-orchestrator/.mcp.json
{
  "mcpServers": {
    "mission-control": {
      "command": "node",
      "args": ["/Users/evgesha/Documents/Projects/mission-control/repos/server/dist/index.js"],
      "env": {
        "MISSION_CONTROL_DB": "./db/mission-control.db"
      }
    }
  }
}
```

The master orchestrator could have its own database that tracks cross-domain features, or query each domain's database — that's a future design decision.

## Migration Steps Required

### Phase 1: Extract Mission Control

#### 1.1 Create Mission Control project
```bash
mkdir -p ~/Documents/Projects/mission-control/{repos,docs}
```

#### 1.2 Move the server out of the orchestrator
```bash
mv ~/Documents/Projects/median-code/mission-control ~/Documents/Projects/mission-control/repos/server
```

#### 1.3 Move the design spec
The Mission Control design spec currently lives in the frontend repo. Move it to the Mission Control project:
```bash
mv ~/Documents/Projects/median-code-frontend/docs/superpowers/specs/2026-03-15-mission-control-design.md \
   ~/Documents/Projects/mission-control/docs/design.md
```

#### 1.4 Create Mission Control workspace
Create `~/Documents/Projects/mission-control/mission-control.code-workspace` with the server folder.

#### 1.5 Verify server still works from new location
```bash
cd ~/Documents/Projects/mission-control/repos/server
npm test        # 50 tests should pass
npm run build   # dist/ should compile
```

#### 1.6 Extract git history for Mission Control
Preserve the git history from the orchestrator repo using subtree split:
```bash
cd ~/Documents/Projects/median-code
git subtree split --prefix=mission-control -b mission-control-history
cd ~/Documents/Projects/mission-control/repos/server
git init
git pull ~/Documents/Projects/median-code mission-control-history
```
Then clean up the temporary branch:
```bash
cd ~/Documents/Projects/median-code
git branch -d mission-control-history
```

### Phase 2: Create Median project structure

#### 2.1 Create the new root directory
```bash
mkdir -p ~/Documents/Projects/mediancode/{repos,business/plans,business/questionnaires,design/brand,finance,legal,marketing,archive}
```

#### 2.2 Move code repositories (keep original names)
```bash
mv ~/Documents/Projects/median-code-frontend ~/Documents/Projects/mediancode/repos/median-code-frontend
mv ~/Documents/Projects/median-code-backend ~/Documents/Projects/mediancode/repos/median-code-backend
```

#### 2.3 Move the software orchestrator
```bash
mv ~/Documents/Projects/median-code ~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator
```

Note: After this move, the orchestrator no longer contains `mission-control/` (moved in Phase 1).

#### 2.4 Update orchestrator symlinks
```bash
cd ~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator
rm frontend backend
ln -s ../median-code-frontend frontend
ln -s ../median-code-backend backend
```

#### 2.5 Update orchestrator's .mcp.json
The MCP config must now point to the extracted Mission Control server and use a local DB:
```json
{
  "mcpServers": {
    "mission-control": {
      "command": "node",
      "args": ["/Users/evgesha/Documents/Projects/mission-control/repos/server/dist/index.js"],
      "env": {
        "MISSION_CONTROL_DB": "./db/mission-control.db"
      }
    }
  }
}
```

Create the local db directory:
```bash
mkdir -p ~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/db
touch ~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/db/.gitkeep
```

If there was existing data in the old `mission-control/db/mission-control.db`, move it:
```bash
mv ~/Documents/Projects/mission-control/repos/server/db/mission-control.db \
   ~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/db/mission-control.db
```

#### 2.6 Move business & design files
```bash
mv ~/Documents/Projects/MedianCode/business\ plan/* ~/Documents/Projects/mediancode/business/plans/
mv ~/Documents/Projects/MedianCode/RMA\ Business\ Plan\ Questionnaire.docx ~/Documents/Projects/mediancode/business/questionnaires/
mv ~/Documents/Projects/MedianCode/color\ palette/* ~/Documents/Projects/mediancode/design/brand/
```

#### 2.7 Move archive and delete templates
```bash
mv ~/Documents/Projects/MedianCode/api-craft ~/Documents/Projects/mediancode/archive/api-craft
mv ~/Documents/Projects/MedianCode/fastapi_craft ~/Documents/Projects/mediancode/archive/fastapi-craft
mv ~/Documents/Projects/MedianCode/template_api ~/Documents/Projects/mediancode/archive/template-api
mv ~/Documents/Projects/MedianCode/template_api.zip ~/Documents/Projects/mediancode/archive/
mv ~/Documents/Projects/MedianCode/template_fastapi ~/Documents/Projects/mediancode/archive/template-fastapi
rm -rf ~/Documents/Projects/MedianCode/templates
```

### Phase 3: Update workspace and tooling

#### 3.1 Move and update VS Code workspace file
```bash
mv ~/Documents/Projects/median-code.code-workspace ~/Documents/Projects/mediancode/mediancode.code-workspace
```

Update all folder paths and names:
- `median-code` → `repos/mediancode-dev-orchestrator`
- `median-code-frontend` → `repos/median-code-frontend`
- `median-code-backend` → `repos/median-code-backend`

Update all task `cwd` references to use the new `${workspaceFolder:...}` names.

#### 3.2 Update Claude Code project settings
Claude Code stores project-specific settings (memory, feedback, session config) at `~/.claude/projects/<path-encoded>/`. After moving repos:

Affected directories (copy old → new):
- `~/.claude/projects/-Users-evgesha-Documents-Projects-median-code-frontend/` → `-Users-evgesha-Documents-Projects-mediancode-repos-median-code-frontend/`
- `~/.claude/projects/-Users-evgesha-Documents-Projects-median-code-backend/` → `-Users-evgesha-Documents-Projects-mediancode-repos-median-code-backend/`
- `~/.claude/projects/-Users-evgesha-Documents-Projects-median-code/` → `-Users-evgesha-Documents-Projects-mediancode-repos-mediancode-dev-orchestrator/`

Within each project settings directory, update any absolute paths in:
- `memory/MEMORY.md` and individual memory files
- `.claude/CLAUDE.md` (session instructions)

#### 3.3 Update internal references
Files inside repos that reference sibling repo paths:
- `mediancode-dev-orchestrator/CLAUDE.md` — update any absolute path references
- `mediancode-dev-orchestrator/.mcp.json` — already updated in step 2.5
- Frontend/backend CLAUDE.md files — check for hardcoded paths to sibling repos
- Any hardcoded paths in test configs, CI configs, scripts

#### 3.4 Update orchestrator's .gitignore
Remove the `mission-control/` entries (it's no longer inside the orchestrator). Add `db/*.db` for the local database:
```gitignore
# Child repos (their own git)
frontend/
backend/

# Local database
db/*.db

# OS
.DS_Store
```

### Phase 4: Rebuild and verify

#### 4.1 Verify Mission Control
```bash
cd ~/Documents/Projects/mission-control/repos/server
npm test        # 50 tests pass
npm run build   # compiles cleanly
```

#### 4.2 Verify frontend
```bash
cd ~/Documents/Projects/mediancode/repos/median-code-frontend
bun install     # required — hardlinks broken by move
bun run svelte-check --tsconfig ./tsconfig.json
```

#### 4.3 Verify backend
```bash
cd ~/Documents/Projects/mediancode/repos/median-code-backend
# Recreate virtualenv if needed
# Run tests
```

#### 4.4 Verify orchestrator MCP server starts
Open a Claude Code session in `~/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/` and verify mission-control tools are available.

### Phase 5: Clean up old locations

After verifying everything works:
```bash
# Remove empty MedianCode dirs
rmdir ~/Documents/Projects/MedianCode/templates/API ~/Documents/Projects/MedianCode/templates 2>/dev/null
rmdir ~/Documents/Projects/MedianCode/business\ plan ~/Documents/Projects/MedianCode/color\ palette 2>/dev/null
rmdir ~/Documents/Projects/MedianCode 2>/dev/null

# Old locations are already moved, not deleted — verify they're gone:
ls ~/Documents/Projects/median-code-frontend 2>/dev/null && echo "WARNING: frontend not moved"
ls ~/Documents/Projects/median-code-backend 2>/dev/null && echo "WARNING: backend not moved"
ls ~/Documents/Projects/median-code 2>/dev/null && echo "WARNING: orchestrator not moved"
ls ~/Documents/Projects/median-code.code-workspace 2>/dev/null && echo "WARNING: workspace not moved"
```

## Risks and Considerations

1. **Claude Code memory migration** — the most delicate part. All project memories, feedback entries, and session settings are keyed by filesystem path. Migrating means copying directories and updating absolute paths inside memory files.

2. **bun hardlinks** — moving `median-code-frontend/` will break bun's hardlinked `node_modules`. Must run `bun install` after the move.

3. **Git remote URLs** — unaffected (they point to GitHub, not local paths).

4. **Backend virtualenv** — if using absolute paths in the virtualenv, it may need recreating after the move.

5. **Active work** — this migration should be done when no branches have uncommitted work. Run `git status` in all repos first.

6. **VS Code** — close VS Code before the migration. Reopen with the workspace file from its new location after.

7. **Mission Control git history** — using `git subtree split` to extract with history. If subtree split fails or produces unexpected results, fall back to fresh `git init` (only 14 commits of history).

8. **Absolute path in .mcp.json** — Mission Control server uses absolute path (`/Users/evgesha/Documents/Projects/mission-control/repos/server/dist/index.js`). Not portable across machines, but this is a personal project. `MISSION_CONTROL_DB` stays relative (`./db/mission-control.db`) — each orchestrator's DB is local.

## What This Spec Does NOT Cover

- Building the master orchestrator (`mediancode-master-orchestrator/`) — future task
- Building domain-specific orchestrators (marketing, etc.) — future
- Setting up cross-domain pipeline coordination — future
- Renaming `median-code-frontend` → `mediancode-frontend` and `median-code-backend` → `mediancode-backend` — separate follow-up task (involves GitHub repo rename, git remotes, Claude Code settings, CI)
- CI/CD updates — none currently affected since deploys use git remotes
- Making Mission Control installable as an npm package — future (currently referenced by file path)
- Mission Control's own organizational structure beyond `repos/server/` — future

## Decisions (Resolved)

1. **`api-craft/`** — Remove. Goes to `mediancode/archive/api-craft/`.
2. **Claude Code project settings** — Migrate. Copy old path-keyed directories to new path-keyed directories, update absolute paths inside memory files.
3. **`MedianCode/templates/`** — Remove. Delete the directory entirely.
4. **Mission Control git history** — Preserve. Use `git subtree split` to extract `mission-control/` subdirectory with full history into the new standalone repo.
5. **`.mcp.json` paths** — Absolute for Mission Control server (`/Users/evgesha/Documents/Projects/mission-control/repos/server/dist/index.js`). Relative for `MISSION_CONTROL_DB` (`./db/mission-control.db`) since it's local to each orchestrator.
6. **Project root name** — `mediancode/` (no hyphen, not abbreviated).
7. **Orchestrator naming** — `mediancode-<domain>-orchestrator` suffix for explicitness.
8. **Repo nesting** — All git repos (orchestrators + code) under `repos/`. Domain folders at project root.
9. **Code repo naming** — Keep `median-code-frontend` and `median-code-backend` during migration. Rename to `mediancode-frontend` / `mediancode-backend` as a separate follow-up task.
