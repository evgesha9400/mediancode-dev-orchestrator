# Stage-Agent Architecture Design

**Status:** Completed (2026-03-16)

## Goal

Replace the single-agent-does-everything model with a structured system where each pipeline step dispatches a purpose-built agent that follows a specific skill.

## What Was Implemented

### Three-Layer Model

| Layer | Role | Example |
|---|---|---|
| **Stage** (when) | Pipeline phase with entry/exit conditions | Plan, Implement |
| **Agent** (who) | Persona with constraints and output contract | svelte-architect, code-reviewer |
| **Skill** (how) | Procedure/workflow to follow | autonomous-executing-plans |

These layers do not leak into each other:
- Skills define process, not coding style
- Agent definitions define behavior, not workflow steps
- Stages define timing and gating, not execution details

### Pipeline YAML — `pipelines/software-dev.yaml`

Two stages (Plan, Implement), each with steps:

```yaml
stages:
  - name: Plan
    steps:
      - name: Write Plans       # parallel FE + BE agents
      - name: Plan Review       # code-reviewer, loops back to Write Plans
  - name: Implement
    steps:
      - name: Code              # parallel FE + BE agents
      - name: Code Review       # code-reviewer, loops back to Code
```

Exit conditions enforce required artifacts and human approval per stage.

### Agent Definitions — `.claude/agents/`

| Agent | Purpose | Constraint |
|---|---|---|
| `svelte-architect` | Frontend implementation | `frontend/` only, `fe--*` skills |
| `senior-code-architect-PY` | Backend implementation | `backend/` only, `be--*` skills |
| `code-reviewer` | Cross-repo review | Read-only, no code modification |

### Skill Naming Convention

| Prefix | Who loads it |
|--------|-------------|
| `fe--*` | Frontend agents only |
| `be--*` | Backend agents only |
| `orch--*` | Orchestrator only |
| No prefix | Any agent |

### Dispatch Flow — `orch--dispatch-pipeline` skill

The orchestrator:
1. Creates feature in MC CLI, links services
2. Dispatches scoped subagents per step (via Agent tool)
3. Records artifacts and status transitions via `mc` CLI
4. Presents stage gates for human approval
5. Advances feature through stages

The orchestrator never writes plans or code itself — it only coordinates. This preserves context window for each subagent.

### Loop-Back Mechanism

Review steps can loop back to their preceding work step:
- Plan Review → Write Plans (if plans don't pass review)
- Code Review → Code (if implementation doesn't pass review)

The review feedback is appended to the re-dispatch prompt.

### Living Documents — `pipelines/software-dev/`

```
pipelines/software-dev/
  learnings/       # Accumulated patterns and anti-patterns per stage
    plan.md
    implement.md
  observations/    # Raw observations collected during each stage
    plan.md
    implement.md
```

### Work Artifacts — `docs/work/`

Specs and plans grouped by initiative:
```
docs/work/{initiative-name}/
  spec.md
  plan-frontend.md
  plan-backend.md
docs/work/completed/{initiative-name}/   # moved here when done
```

### Key Skill: `autonomous-executing-plans`

Subagent-specific skill that executes plans without stopping for human approval. Solves the problem of superpowers:executing-plans pausing at checkpoints when running as a subagent.

### Project-Level `/commit` Command

Overrides the user-level commit command to remove `allowed-tools` restriction, which was causing subagents to stop after each commit.

## What Was NOT Implemented (Future Work)

### Retrospective System

An automated learning loop where a retrospective agent:
- Collects observations from stage agents
- Classifies learnings (process → skills, behavioral → agent defs, domain → living docs)
- Presents report for human approval
- Applies approved changes

This was designed but deferred — we need more pipeline runs to validate which learnings would actually be useful.

### Autonomy Modes

Per-stage configurable modes (human-in-the-loop, semi-autonomous, autonomous). Currently everything is human-in-the-loop. Relaxing autonomy requires trust built through successful pipeline runs.

### Observation Collection

Structured observation logging by agents during work (PROBLEM, DECISION, SURPRISE, FRICTION, SUCCESS categories). Deferred until the retrospective system is implemented to consume them.

### Additional Agents

- `design-agent` — brainstorming and spec writing
- `test-runner` — impartial test execution
- `integration-tester` — cross-service browser automation
- `retrospective-agent` — learning classification and routing

### `mc dispatch` Command

Moving prompt construction from AI skill prose to deterministic CLI templates. Spec exists at MC repo `docs/work/deterministic-dispatch/spec.md`.

### Multi-LLM Support

Dispatching non-Claude agents (Codex, Gemini) via CLI for adversarial review. Backlog feature in MC.
