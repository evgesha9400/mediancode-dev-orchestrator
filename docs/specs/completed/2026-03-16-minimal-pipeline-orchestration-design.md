# Minimal Pipeline Orchestration — Design Spec

**Date:** 2026-03-16
**Status:** Draft

## Goal

Build the smallest working pipeline that coordinates scoped frontend and backend agents through a plan-then-implement cycle with global consistency verification. Prove the orchestration model works end-to-end before adding stages, observations, retrospective, or learning systems.

## Test Feature

The [Param Inference spec](2026-03-14-param-inference-design.md) serves as the feature brief. It touches both repos (backend: code generation + API, frontend: endpoint form UI), has a clear API contract, and is already complete. Brainstorm is skipped.

## Flow

```
Write Plans (scoped) → Verify Plans (global) → Implement (scoped, parallel) → Verify Implementation (global)
```

Four steps, two scoping modes:

| Step | Agent(s) | Scope | Input | Output |
|---|---|---|---|---|
| **Write Plans** | `svelte-architect`, `senior-code-architect-PY` | Scoped (each sees own repo) | Param inference spec | `frontend/docs/plans/param-inference.md`, `backend/docs/plans/param-inference.md` |
| **Verify Plans** | `code-reviewer` | Global (sees both repos via symlinks) | Both plans + original spec | Pass/fail + issues list |
| **Implement** | `svelte-architect`, `senior-code-architect-PY` | Scoped (parallel) | Their respective plan | Code commits |
| **Verify Implementation** | `code-reviewer` | Global | Both codebases + both plans + spec | Pass/fail + issues list |

**Scoped agents** receive the original spec as read-only context (so they know the API contract) but can only write to their own repo.

**Global verifier** reads both repos but writes nothing — it only reports.

## Mission Control CLI

### Migration from MCP

MC is rewritten from a TypeScript MCP server to a Python CLI. The dispatcher calls it via shell commands with JSON output — deterministic, no LLM decision-making in the loop for infrastructure operations.

- **Language:** Python 3.13+
- **CLI framework:** `typer` or `click`
- **Database:** SQLite (same as before)
- **Output:** JSON (all commands)
- **Install:** `poetry install` puts `mc` on PATH
- **Domain-agnostic:** MC knows pipelines, features, stages, steps, artifacts. It does not know what "frontend" or "backend" means. All domain config lives in pipeline YAML.

### Commands (10)

**Pipeline & feature lifecycle:**

```bash
mc pipeline create --file software-dev.yaml    # Reads file at path (relative to CWD), stores YAML contents in DB
mc feature create --title "..." --pipeline <id> # Creates feature at first YAML stage, auto-creates all stage_progress rows
mc feature get <id>                             # Returns JSON: {id, title, current_stage, status, stages: [{stage, step, status}], services: [{name, status}], artifacts: [{stage, step, type, content}]}
mc feature advance <id> [--approved]            # Validates exit conditions, moves to next stage
```

**Progress tracking:**

```bash
mc step update <feature_id> <stage> [step] --status <status>  # Stage-level if step omitted, step-level if provided
mc service register <name> --path <path> --stack <stack>       # One-time setup
mc service link <feature_id> <service_name>                    # Link service to feature
mc service status <feature_id> <service_name> --status <status> # Per-service progress (informational — not checked by advance)
```

**Artifacts:**

```bash
mc artifact add <feature_id> <stage> [--step <step>] --type <type> --content <value>  # Stores value as-is (string); does NOT read files
mc artifact get <feature_id> [--stage <stage>] [--step <step>]                         # Returns artifacts ordered by created_at DESC
```

Status values: `pending`, `in_progress`, `completed`, `failed`, `skipped`.

### Two-Level Addressing

All `mc step update` and `mc artifact add` commands use consistent two-level addressing:

- **Stage-level:** `mc step update <feature_id> Plan --status in_progress` — updates the `__stage__` sentinel row for the "Plan" stage
- **Step-level:** `mc step update <feature_id> Plan "Write Plans" --status in_progress` — updates the specific step row

Stage names and step names come from the pipeline YAML. `mc feature create` sets `current_stage` to the first stage in the YAML's `stages` array and auto-creates `stage_progress` rows for every stage (with `step='__stage__'`) and every step defined in the YAML. This means `mc feature advance` can reliably check that all child steps are `completed` or `skipped`.

### Database Schema (6 tables)

```sql
CREATE TABLE pipelines (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    config TEXT NOT NULL,          -- YAML file contents stored as text
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE features (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    current_stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active|paused|completed|cancelled
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE stage_progress (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '__stage__',  -- sentinel for stage-level rows; '__stage__' is reserved and must not be used as a YAML step name
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|completed|skipped|failed
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(feature_id, stage, step)
);

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '__stage__',
    type TEXT NOT NULL,
    content TEXT NOT NULL,            -- file path, URL, or identifier (e.g. commit SHA)
    created_at TEXT NOT NULL
);

CREATE TABLE services (
    name TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    stack TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE feature_services (
    feature_id TEXT NOT NULL REFERENCES features(id),
    service_name TEXT NOT NULL REFERENCES services(name),
    status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY (feature_id, service_name)
);
```

### Exit Condition Validation

`mc feature advance <id> [--approved]` checks the current stage's exit conditions from the pipeline YAML:

1. **required_artifacts:** all artifact types listed in the stage's `exit_conditions.required_artifacts` must exist in the `artifacts` table for this feature and stage
2. **all children complete:** every `stage_progress` row where `stage = current_stage` and `step != '__stage__'` must have status `completed` or `skipped`
3. **human_approval:** if `exit_conditions.human_approval: true` in the YAML, the `--approved` flag must be passed

If all checks pass, `features.current_stage` advances to the next stage. If the current stage is the last, `features.status` is set to `completed`.

### Loop-Back Mechanics

When a verify step fails and loops back:

1. Dispatcher calls `mc step update <feature_id> <stage> <target_step> --status in_progress` — this resets the target step (the `step update` command sets `started_at` to now and clears `completed_at` when status is `in_progress`)
2. Dispatcher resets the per-service statuses: `mc service status <feature_id> <service> --status in_progress`
3. Existing artifacts from the previous attempt are **not deleted** — new artifacts are appended. The `mc feature advance` check only cares that required artifact types exist, not how many.
4. The dispatcher re-dispatches the scoped agents with the review feedback appended to their prompt

## Pipeline YAML

```yaml
name: Software Development

stages:
  - name: Plan
    exit_conditions:
      required_artifacts: [implementation-plan, plan-review-report]
      human_approval: true
    steps:
      - name: Write Plans
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: writing-plans
        parallel: true

      - name: Plan Review
        agent: code-reviewer
        skill: plan-review
        loop_back_to: Write Plans

  - name: Implement
    exit_conditions:
      required_artifacts: [implementation-commit, review-report]
      human_approval: true
    steps:
      - name: Code
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: executing-plans
        parallel: true

      - name: Code Review
        agent: code-reviewer
        skill: requesting-code-review
        loop_back_to: Code
```

Exit conditions are on the **stage** level only. Steps define agents, skills, and loop-back targets. The stage advances when all its required artifacts exist, all child steps are complete, and human approval is given (if required).

## Dispatcher Skill

The `dispatch-pipeline` skill is rewritten to call MC CLI. It runs in the orchestrator repo.

### One-time setup

```bash
mc service register frontend --path ./frontend --stack sveltekit
mc service register backend --path ./backend --stack fastapi
mc pipeline create --file pipelines/software-dev.yaml
```

### Per-feature flow

```
 1. mc feature create --title "Param Inference" --pipeline <id>
 2. mc service link <feature_id> frontend
 3. mc service link <feature_id> backend
 4. mc feature get <feature_id>  →  determine current_stage = "Plan"

═══ STAGE: PLAN ═══

 5. mc step update <feature_id> Plan --status in_progress

── Step: Write Plans ──
 6. mc step update <feature_id> Plan "Write Plans" --status in_progress
 7. Dispatch svelte-architect (scoped to frontend/)
    Input: param-inference spec
    Output: frontend/docs/plans/param-inference.md
 8. mc service status <feature_id> frontend --status completed
 9. Dispatch senior-code-architect-PY (scoped to backend/)
    Input: param-inference spec
    Output: backend/docs/plans/param-inference.md
10. mc service status <feature_id> backend --status completed
11. mc artifact add <feature_id> Plan --step "Write Plans" --type implementation-plan --content frontend/docs/plans/param-inference.md
12. mc artifact add <feature_id> Plan --step "Write Plans" --type implementation-plan --content backend/docs/plans/param-inference.md
13. mc step update <feature_id> Plan "Write Plans" --status completed

── Step: Plan Review ──
14. mc step update <feature_id> Plan "Plan Review" --status in_progress
15. Dispatch code-reviewer (global, sees both repos)
    Input: both plans + original spec
    Checks: API contract alignment — do endpoints, request/response shapes match?
16. If fail →
      mc step update <feature_id> Plan "Write Plans" --status in_progress
      mc service status <feature_id> frontend --status in_progress
      mc service status <feature_id> backend --status in_progress
      Loop back to step 7 with review feedback appended to agent prompts
    If pass →
      mc artifact add <feature_id> Plan --step "Plan Review" --type plan-review-report --content <path>
      mc step update <feature_id> Plan "Plan Review" --status completed

── Stage Gate ──
17. mc step update <feature_id> Plan --status completed
18. PAUSE — dispatcher prints summary and asks user for approval inline (Claude Code interactive prompt)
19. mc feature advance <feature_id> --approved
    (validates: implementation-plan ✓, plan-review-report ✓, all steps completed ✓, human approved ✓)

═══ STAGE: IMPLEMENT ═══

20. mc feature get <feature_id>  →  current_stage = "Implement"
21. mc step update <feature_id> Implement --status in_progress

── Step: Code ──
22. mc step update <feature_id> Implement Code --status in_progress
23. Dispatch svelte-architect + senior-code-architect-PY (parallel via Agent tool)
    Input: their respective plan from {repo}/docs/plans/param-inference.md
    Output: code on feature branches
24. mc service status <feature_id> frontend --status completed
25. mc service status <feature_id> backend --status completed
26. mc artifact add <feature_id> Implement --step Code --type implementation-commit --content <frontend-sha>
27. mc artifact add <feature_id> Implement --step Code --type implementation-commit --content <backend-sha>
28. mc step update <feature_id> Implement Code --status completed

── Step: Code Review ──
29. mc step update <feature_id> Implement "Code Review" --status in_progress
30. Dispatch code-reviewer (global)
    Input: both codebases + both plans + spec
    Checks: does code match plans? Do API contracts align in actual code?
31. If fail →
      mc step update <feature_id> Implement Code --status in_progress
      mc service status <feature_id> frontend --status in_progress
      mc service status <feature_id> backend --status in_progress
      Loop back to step 23 with review feedback appended to agent prompts
    If pass →
      mc artifact add <feature_id> Implement --step "Code Review" --type review-report --content <path>
      mc step update <feature_id> Implement "Code Review" --status completed

── Stage Gate ──
32. mc step update <feature_id> Implement --status completed
33. PAUSE — dispatcher prints summary and asks user for approval inline (Claude Code interactive prompt)
34. mc feature advance <feature_id> --approved
    (validates: implementation-commit ✓, review-report ✓, all steps completed ✓, human approved ✓)
    → features.status = "completed" (last stage)
```

### Parallel Dispatch

When a step has `parallel: true` and multi-service agents, the dispatcher uses Claude Code's `Agent` tool to launch both subagents concurrently in the same message (multiple tool calls). The dispatcher waits for both to complete before proceeding.

If one succeeds and one fails: the successful agent's work is preserved (committed to branch), the failure is reported to the human, who decides whether to retry the failed service or roll back.

### Service Status

`mc service status` is **informational tracking** — it lets the human and dispatcher see per-service progress when inspecting a feature via `mc feature get`. It is not checked by `mc feature advance`. The advance command only checks `stage_progress` rows and `artifacts`.

## Agent Prompt Templates

All templates use `{placeholders}` — replaced by the dispatcher with actual values at dispatch time.

### Scoped Agent — Plan Writing

```
You are {agent_name} writing an implementation plan for: "{feature_title}"

## Your Scope
Working directory: {repo_path}/
You ONLY modify files in this repo. Do not reference the other repo's internals.

## Feature Spec
{feature_spec_content}

## Your Task
Write an implementation plan to {repo_path}/docs/plans/{feature_slug}.md
The plan must specify every endpoint, request/response shape, and type
that your repo will implement. Be explicit about the API contract —
another agent implementing the other side will only see this plan
and the original spec.

## Review Feedback (only present on loop-back iterations)
{review_feedback}

## Output
When done, output the path to your plan file.
```

### Scoped Agent — Implementation

```
You are {agent_name} implementing: "{feature_title}"

## Your Scope
Working directory: {repo_path}/
You ONLY modify files in this repo. Use only {scope_prefix}--* skills.
{scope_prefix} is "fe" for frontend, "be" for backend.
Read {repo_path}/CLAUDE.md for project conventions.

## Implementation Plan
{plan_content}

## Feature Spec (read-only context)
{feature_spec_content}

## Review Feedback (only present on loop-back iterations)
{review_feedback}

## Your Task
Implement the plan. Commit your work to a feature branch.

## Output
When done, output the commit SHA.
```

### Global Verifier

```
You are code-reviewer verifying cross-repo consistency for: "{feature_title}"

## Feature Spec
{feature_spec_content}

## Frontend {artifact_type}
{frontend_content}

## Backend {artifact_type}
{backend_content}

## Your Task
Check API contract alignment:
- Do endpoint paths match between frontend and backend?
- Do request/response shapes match?
- Do types match (field names, types, optionality)?
- Do status codes match?

You do NOT modify any code. Report only.

## Output
For each contract point, report: PASS or FAIL with specific mismatch details.
Final verdict: PASS (all checks passed) or FAIL (any check failed).
```

## Agent Definitions

Three agent files in `.claude/agents/`, minimal to start. These are the source definitions — the dispatcher reads them when constructing prompts.

### `.claude/agents/svelte-architect.md`
Based on the existing `svelte-architect` subagent type in Claude Code. Added: output contract (plan path or commit SHA). Scoped to `frontend/` only. Uses only `fe--*` skills.

### `.claude/agents/senior-code-architect-PY.md`
Based on the existing `senior-code-architect-PY` subagent type in Claude Code. Added: output contract. Scoped to `backend/` only. Uses only `be--*` skills.

### `.claude/agents/code-reviewer.md`
New agent. Identity: reviews plans and code against specs for cross-repo consistency. Hard constraint: does NOT modify code, reports only. Outputs: structured pass/fail per contract point.

Note: `svelte-architect` and `senior-code-architect-PY` exist as Claude Code built-in subagent types. The `.claude/agents/` files capture additional project-specific constraints (output contract, skill scoping) that supplement the built-in definitions.

## What's Explicitly Out of Scope

- Brainstorm / Design stage
- Test / Integration / Release stages
- Observations, learnings, retrospective
- Escalation and duplicate detection
- Living documents
- The `autonomous` and `semi-autonomous` modes
- Recursive stage nesting beyond 2 levels

All of these are added after the minimal flow is proven.

## Implementation Order (Vertical Slices)

Built and tested one command at a time, end-to-end:

1. `mc pipeline create` + `mc feature create` + `mc feature get` — can create and inspect a feature
2. `mc service register` + `mc service link` — can register services and link to feature
3. `mc step update` + `mc service status` — can track progress
4. `mc artifact add` + `mc artifact get` — can store and retrieve artifacts
5. `mc feature advance` — can advance with exit condition validation
6. Dispatcher skill — wires it all together, calls MC CLI
7. Agent definitions — create the three `.claude/agents/` files
8. End-to-end test — run param inference feature through the full flow
9. Update orchestrator `CLAUDE.md` — replace MCP references with CLI usage
