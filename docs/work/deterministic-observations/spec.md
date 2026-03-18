# Spec: Deterministic Observation Collection

## Problem

Observation collection during feature implementation relies on the orchestrator LLM remembering to include observation instructions in free-form dispatch prompts. This is fundamentally unreliable — a full feature implementation (9 commits across 2 repos) produced zero observations despite instructions existing at three separate layers:

1. Agent definitions (`.claude/agents/*.md`) — contain "Immediate Observation Triggers" but are **not auto-loaded** by the Agent tool
2. `autonomous-executing-plans` skill — has observation triggers but was never invoked by the orchestrator
3. `/commit` skill — has an observation check section, but subagents lacked `feature_id`, `stage`, and a working `mc` command

### Root Causes

| Cause | Impact |
|-------|--------|
| `.claude/agents/*.md` not injected into subagent context | Agents never see observation trigger rules |
| Dispatch prompt assembled by LLM, not by code | LLM silently omits observation context |
| `mc` not in PATH for subagents | `command not found` even if agent tries |
| `MC_DB` unset + varying cwd | Wrong database or missing database |
| No finalization handshake | "Zero observations" is ambiguous — forgot vs. checked-and-none |

## Design

Six components that eliminate LLM judgment from the observation pipeline.

### 1. `bin/mc` Wrapper (orchestrator repo)

A shell script at `bin/mc` in the orchestrator repo with dynamic path resolution:

```bash
#!/usr/bin/env bash
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MC_DB="${REPO_ROOT}/db/mission-control.db"
MC_INSTALL="$(cd "${REPO_ROOT}/../.." 2>/dev/null && pwd)/mission-control"
exec poetry -C "${MC_INSTALL}" run mc "$@"
```

This solves PATH and MC_DB simultaneously. Uses `poetry -C` instead of hardcoding `.venv/bin/mc` to stay consistent with Poetry-based dependency management. Every dispatch prompt references `bin/mc` (relative to the orchestrator repo root).

### 2. `mc dispatch` Commands (mission-control repo)

Four new CLI commands under a `dispatch` command group.

#### `mc dispatch render`

Generates a complete observation context block for inclusion in a subagent dispatch prompt.

```bash
mc dispatch render <feature_id> <stage> \
  --service-name <service_name> \
  --agent-name <agent_name> \
  --mc-path <path_to_mc_wrapper>
```

Output: a text block containing all observation parameters, trigger conditions, and the exact `mc observation add` command template — ready to paste verbatim into an Agent prompt.

The command creates a dispatch record in the database (new `dispatches` table) and returns the generated `dispatch_id` within the block.

Stage values are **normalized to lowercase** on write (e.g., `Plan` → `plan`, `Implement` → `implement`) to prevent casing drift in observation file naming.

**Database — `dispatches` table:**

```sql
CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    service_name TEXT NOT NULL REFERENCES services(name),
    agent_name TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    observation_check TEXT,
    created_at TEXT NOT NULL
);
```

**Output format** (printed to stdout, using simplified `--dispatch-id` command):

```
---BEGIN OBSERVATION CONTEXT---
## Mission Control — Observation Recording

MC command: {mc_path}
Feature ID: {feature_id}
Stage: {stage}
Dispatch ID: {dispatch_id}
Agent Name: {agent_name}

### When to record (immediately, before your next tool call):
- Same error/test failure occurred more than twice → category: PROBLEM
- You deviated significantly from the plan → category: DECISION
- A tool, skill, or instruction was broken/misleading → category: FRICTION
- You made a judgment call affecting shared rules → category: DECISION
- You are about to return with incomplete work → category: PROBLEM

### Command template:
{mc_path} observation add --dispatch-id {dispatch_id} --category {{CATEGORY}} \
  --title "..." --detail "..." --resolution "..."

### Before returning results:
You MUST run this before completing your work:
  {mc_path} dispatch finalize {dispatch_id}
---END OBSERVATION CONTEXT---
```

The rendered block uses the simplified `--dispatch-id` form — `feature_id`, `stage`, `scope`, `agent_name`, and `attempt` are all inferred from the dispatch record.

#### `mc dispatch finalize`

Marks a dispatch as complete. Auto-derives `observation_check` by querying the database for observations matching this `dispatch_id`.

```bash
mc dispatch finalize <dispatch_id>
```

- Queries `observations` table for rows with this `dispatch_id`
- Sets `observation_check` to `recorded` if count > 0, `none` if count == 0
- Updates `dispatches.status` to `completed`
- **Idempotent**: re-finalizing an already-completed dispatch is a no-op (re-derives and updates `observation_check` from current DB state)

#### `mc dispatch verify`

Checks whether a dispatch has been finalized. Used by the orchestrator after subagent returns.

```bash
mc dispatch verify <dispatch_id>
```

- Exit code 0 if finalized (`status == 'completed'`)
- Exit code 1 if not finalized (still `active` or missing)
- JSON output: `{"dispatch_id": "...", "status": "...", "observation_check": "..."}`

#### `mc dispatch cancel`

Cancels an orphaned or abandoned dispatch (e.g., when a render was created but the dispatch was never sent or was blocked by the hook).

```bash
mc dispatch cancel <dispatch_id>
```

- Updates `dispatches.status` to `cancelled`
- Idempotent: cancelling an already-cancelled dispatch is a no-op

### 3. Simplified `mc observation add` (mission-control repo)

When a dispatch record exists, `mc observation add` can infer most parameters from it. Support a `--dispatch-id`-only mode:

```bash
mc observation add --dispatch-id <dispatch_id> \
  --category PROBLEM --title "..." --detail "..." --resolution "..."
```

When `--dispatch-id` is provided without positional `feature_id`/`stage`, look up the dispatch record and fill in `feature_id`, `stage`, `scope` (from `service_name`), `agent_name`, and `attempt` automatically.

**Typer signature change**: The current positional `feature_id` and `stage` arguments must change from `typer.Argument(...)` (required) to `typer.Argument(None)` (optional). Manual validation inside the function ensures either `--dispatch-id` OR the positional args are provided. Backward compatible — existing callers with positional args still work.

### 4. PreToolUse Hook on Agent (orchestrator repo)

A Claude Code project hook in `.claude/settings.json` that fires before every Agent tool call. It checks that the dispatch prompt contains the observation context block markers.

**Hook configuration** (`.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "python3 bin/check-dispatch-prompt.py"
          }
        ]
      }
    ]
  }
}
```

**Hook script** (`bin/check-dispatch-prompt.py`):

Written in Python (not Bash) to reliably parse JSON input without shell escaping issues. Reads the tool input from stdin, extracts `tool_input.subagent_type` and `tool_input.prompt`.

**Agent-type allowlist** — only enforce observation context for implementation agents:
- `senior-code-architect-PY`
- `svelte-architect`

All other agent types (`Explore`, `Plan`, `general-purpose`, `code-reviewer`, etc.) are allowed without the block. This avoids false positives on consult flows, research dispatches, and review agents.

**Logic:**
- If `subagent_type` not in allowlist → exit 0 (allow)
- If `subagent_type` in allowlist and prompt contains `---BEGIN OBSERVATION CONTEXT---` and `---END OBSERVATION CONTEXT---` → exit 0 (allow)
- If `subagent_type` in allowlist and markers missing → output deny decision JSON, exit 0

**Deny output format** (per Claude Code hooks spec):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Implementation dispatch missing observation context block. Run: bin/mc dispatch render <feature_id> <stage> --service-name <svc> --agent-name <agent> --mc-path $(pwd)/bin/mc"
  }
}
```

### 5. Observation Protocol in Root CLAUDE.md (orchestrator repo)

Add a section to the root `CLAUDE.md` (auto-loaded for all sessions). `.claude/CLAUDE.md` is NOT the right surface — root `CLAUDE.md` is the standard auto-loaded location.

```markdown
## Observation Protocol — MANDATORY

All implementation subagent dispatches MUST include an observation context block.

### For the orchestrator (dispatching agents):
1. Run `bin/mc dispatch render <feature_id> <stage> --service-name <svc> --agent-name <agent> --mc-path $(pwd)/bin/mc`
2. Paste the output block verbatim into the Agent prompt
3. After the subagent returns, run `bin/mc dispatch verify <dispatch_id>` — do NOT proceed if it fails
4. After the stage completes, run `bin/mc observation consolidate <feature_id> --output-dir pipelines/software-dev/observations/ --feature-title "<title>"`

The `bin/mc` wrapper handles PATH and database location. Never use bare `mc`.

### For subagents (if you see an observation context block in your prompt):
- Record observations immediately when trigger conditions fire — don't wait for a commit
- Use the exact command template from the block
- Run `dispatch finalize` before returning your results
```

Also update the "Mission Control CLI" section to reference `bin/mc` instead of bare `mc`.

### 6. Dispatch Skill + commit.md Updates (orchestrator repo)

**Update `.claude/skills/orch--dispatch-pipeline/SKILL.md`:**
- Replace all bare `mc` commands with `bin/mc`
- Replace advisory "Include in prompt:" lines with `bin/mc dispatch render` instructions
- Add required `bin/mc dispatch verify <dispatch_id>` step after every Agent return
- Gate `bin/mc observation consolidate` on all dispatches being finalized

**Update `.claude/commands/commit.md`:**
- Replace the hardcoded `mc observation add <feature_id> <stage> ...` command template in the "Observation Check" section with: "If your prompt includes an observation context block, use the exact command template from that block."

**Delete `.claude/skills/dispatch-pipeline/SKILL.md`** — duplicate of `orch--dispatch-pipeline`, drift bait.

### Stage Casing Normalization (mission-control repo)

Normalize `stage` to lowercase on write in both `dispatches` and `observations` modules. The current codebase has drift between lowercase stages in skills (`plan`, `implement`) and title-case stages in tests (`Plan`, `Implement`). Since `observations.py` writes filenames directly from raw `stage`, this creates a portability bug on case-sensitive filesystems.

Apply `stage.lower()` in:
- `create_dispatch()` in `dispatches.py`
- `add_observation()` in `observations.py`

Update existing tests to expect lowercase.

## Enforcement Flow

```
1. Orchestrator runs: bin/mc dispatch render {feature_id} {stage} --service-name frontend ...
2. MC normalizes stage, creates dispatch record, outputs observation context block
3. Orchestrator pastes block into Agent prompt
4. PreToolUse(Agent) hook validates block is present → denies if missing for implementation agents
5. Subagent executes, records observations as needed via bin/mc observation add --dispatch-id ...
6. Subagent runs: bin/mc dispatch finalize {dispatch_id}
7. Subagent returns results
8. Orchestrator runs: bin/mc dispatch verify {dispatch_id} — blocks progress if not finalized
9. Orchestrator runs: bin/mc observation consolidate {feature_id} ...
   (consolidate checks for unfinalized dispatches and refuses if any remain active)
```

## What This Does NOT Change

- Observation triggers in `.claude/agents/*.md` stay as documentation (harmless, just not relied upon)
- `autonomous-executing-plans` skill observation triggers stay (they reference the dispatch block)
- The observation data model (`observations` table) is unchanged structurally
- `mc observation get` is unchanged

## What This DOES Change to Existing Code

- `mc observation consolidate` gains a pre-check: refuse if unfinalized dispatches exist for the feature
- `mc observation add` gains optional `--dispatch-id`-only mode (backward compatible)
- Stage values normalized to lowercase on write in both `observations.py` and new `dispatches.py`

## Out of Scope

- Global `mc` install — the wrapper approach is simpler and version-safe
- `.mc-context.json` state file — the dispatch record in SQLite serves the same purpose
- Review agent (`code-reviewer`) observation enforcement — review agents don't implement, they analyze. Narrowing to implementation agents only.
- `SubagentStop` hook — while Claude Code supports it, the `dispatch verify` step in the orchestrator skill is simpler and more visible. Can add later if needed.
