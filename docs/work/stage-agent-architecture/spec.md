# Stage-Agent Architecture Design

## Goal

Replace the current single-agent-does-everything model with a structured system where each pipeline stage dispatches a purpose-built agent that follows a specific skill, collects observations, and feeds into a retrospective process that improves the system over time.

## Architecture: Event-Driven Pipeline (Approach C)

The `dispatch-pipeline` skill is the central controller. It manages features through stages using a consistent lifecycle. Stages own execution, the pipeline owns lifecycle, and the retrospective is a pipeline-level cross-cutting concern.

### Three-Layer Model

| Layer | Role | Example |
|---|---|---|
| **Stage** (when) | Pipeline phase with entry/exit conditions | Implement |
| **Agent** (who) | Persona with coding style and behavioral constraints | svelte-architect |
| **Skill** (how) | Procedure/workflow to follow | executing-plans |

These layers must not leak into each other:
- Skills define process, not coding style
- Agent definitions define behavior, not workflow steps
- Stages define timing and gating, not execution details

## Pipeline Lifecycle

For each stage:

```
PRE-STAGE
  1. Read MC feature status -> determine current stage
  2. Read stage config from pipeline YAML (agent, skill, autonomy mode)
  3. Read living doc for this stage -> extract accumulated learnings
  4. Prepare stage context (feature description, design spec, previous stage artifacts)

EXECUTE
  5. Construct scoped prompt for the stage agent
  6. Dispatch agent with: stage skill + living doc learnings + feature context
  7. Agent works, collects raw observations continuously
  8. Agent returns: result + raw observations + self-debrief + artifacts

POST-STAGE
  9. Store artifacts in MC
  10. If retrospective enabled for this stage:
      a. Dispatch retrospective-agent with: observations + code diff + living doc
      b. Retrospective classifies learnings, presents report to human
      c. Human approves/rejects each proposed change
      d. Approved changes applied
      e. Retrospective-report artifact recorded
  11. Check exit conditions (required_artifacts met?)
  12. If human_approval required or autonomy=human-in-the-loop: pause for user
  13. If approved: advance to next stage, loop back to PRE-STAGE
  14. If rejected (loop-back): move feature back to target stage, loop back to PRE-STAGE
```

### Loop-Back Mechanism

The Review stage can send a feature back to Implement if quality issues are found:

```
Design → Implement → Review → pass → Release
                  ↑         |
                  └─ fail ──┘
```

When Review identifies issues:
1. Review agent reports problems as artifacts
2. Human decides: send back to Implement (with review report as context), accept anyway, or abort
3. If sent back: dispatcher moves the feature to Implement in MC, re-dispatches the implement agent with the review feedback appended to its context
4. Implement agent fixes issues, runs tests until passing
5. Pipeline advances to Review again

The loop-back is human-controlled — the Review agent recommends but the human decides. The review feedback becomes part of the Implement agent's context on re-entry, so it knows exactly what to fix.

Loop-back triggers a retrospective on the Implement stage (if enabled) after re-implementation completes, capturing why the loop-back was needed.

## Autonomy Modes

Per-stage configurable. Three modes:

| Mode | Behavior |
|---|---|
| `human-in-the-loop` | Pause after every stage for human approval |
| `semi-autonomous` | Pause only at stages with `human_approval: true` |
| `autonomous` | Skip human approval entirely (future, once trust is built) |

Initial default: `human-in-the-loop` for all stages. The `autonomous` mode is a placeholder for future use — not yet implemented.

## Migration from Current YAML

The proposed YAML schema replaces the existing `pipelines/software-dev.yaml`. Key changes:
- `config.skill` and `config.description` move to top-level `skill` field per stage
- New fields: `agent`, `autonomy`, `parallel`, `retrospective`, `post_check`
- New top-level `retrospective` block
- The `dispatch-pipeline` skill must be rewritten to handle the new schema

This is a breaking change. The existing YAML will be overwritten during implementation.

## Recursive Stage Schema

Every node in the pipeline is either a **leaf** or a **container**:

- **Leaf** — has `agent` + `skill`, does work directly. No `steps`.
- **Container** — has `steps`, orchestrates children. No `agent`.

These are mutually exclusive. The dispatcher checks which type a node is and recurses accordingly. A step inside a container could itself be a container with sub-steps, following the same pattern.

Shared fields (valid on both leaf and container nodes):
- `name`, `executor`, `autonomy`, `retrospective`, `observations`
- `exit_conditions`, `document`, `loop_back_to`, `condition`

Leaf-only fields:
- `agent`, `skill`, `model`, `parallel`

Container-only fields:
- `steps`

### Model Selection

The optional `model` field specifies which LLM model to use for a leaf node's agent. Format is the model identifier (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`). If omitted, defaults to the current session's model.

Phase 1 supports Claude models only. The schema accepts any model string to support future providers (e.g., `gemini-2.5-pro`, `gpt-4o`) without schema changes.

## Pipeline YAML

```yaml
name: Software Development

retrospective:
  agent: retrospective-agent
  skill: retrospective
  autonomy: human-in-the-loop
  exit_conditions:
    required_artifacts: [retrospective-report]
    human_approval: true
  document: docs/retrospective.md

stages:
  - name: Design
    autonomy: human-in-the-loop
    observations: true
    retrospective: false
    exit_conditions:
      required_artifacts: [feature-brief, implementation-plan]
      human_approval: true
    document: docs/stages/design.md
    steps:
      - name: Brainstorm
        executor: agent
        agent: design-agent
        model: claude-opus-4-6
        skill: brainstorming
        exit_conditions:
          required_artifacts: [feature-brief]
          human_approval: true

      - name: Plan
        executor: agent
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: writing-plans
        parallel: true
        exit_conditions:
          required_artifacts: [implementation-plan]
          human_approval: false

      - name: Plan Review
        executor: agent
        agent: code-reviewer
        skill: plan-review
        loop_back_to: Plan
        exit_conditions:
          required_artifacts: [plan-review-report]
          human_approval: true

  - name: Implement
    autonomy: human-in-the-loop
    observations: true
    retrospective: true
    exit_conditions:
      required_artifacts: [implementation-commit]
      human_approval: false
    document: docs/stages/implement.md
    steps:
      - name: Code
        executor: agent
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: executing-plans
        parallel: true
        exit_conditions:
          required_artifacts: [implementation-commit]
          human_approval: false

      - name: Test
        executor: agent
        agent: test-runner
        skill: running-tests
        loop_back_to: Code
        exit_conditions:
          required_artifacts: [test-report]
          human_approval: false

      - name: Integration
        executor: agent
        agent: integration-tester
        skill: integration-testing
        condition: multi-service-only
        loop_back_to: Code
        autonomy: human-in-the-loop
        exit_conditions:
          required_artifacts: [integration-report]
          human_approval: true

  - name: Review
    executor: agent
    agent: code-reviewer
    model: claude-opus-4-6
    skill: requesting-code-review
    autonomy: human-in-the-loop
    observations: true
    retrospective: false
    loop_back_to: Implement
    exit_conditions:
      required_artifacts: [review-report]
      human_approval: true
    document: docs/stages/review.md

  - name: Release
    executor: human
    autonomy: human-in-the-loop
    observations: false
    retrospective: false
    exit_conditions:
      required_artifacts: [release-url]
      human_approval: true
    document: docs/stages/release.md
```

## Stage Agent Prompt Structure

Every stage agent is dispatched with a structured prompt constructed by the dispatcher:

```
You are the {stage_name} agent for feature: "{feature_title}"

## Your Identity
Agent: {agent_name}
Skill: Follow the {skill_name} skill for your workflow

## Your Constraints
- You are in {autonomy_mode} mode
- {stage-specific constraints}

## Context
Feature description: {feature_description}
Previous stage artifacts: {artifacts from prior stages}
Services involved: {frontend, backend, or both}

## Living Document Learnings
{contents of docs/stages/{stage}.md}

## Observation Collection — MANDATORY

As you work, maintain a running log of observations:

### Observations
- [timestamp] [category] observation text

Categories:
- PROBLEM: Something went wrong or was harder than expected
- DECISION: A choice you made and why
- SURPRISE: Something unexpected (good or bad)
- FRICTION: Something slowed you down
- SUCCESS: Something that worked well because of an existing learning

At the end of your work, return:
1. Your primary output (artifacts, code, reports)
2. Your complete observations log
3. A one-paragraph self-debrief: what was the hardest part and why
```

Living doc content is injected directly into the prompt so agents are guaranteed to see it.

## Observation Collection

Two phases:

1. **Continuous** — agent writes categorized observations as it encounters them during work
2. **End-of-stage consolidation** — agent returns complete observations log + self-debrief

Raw observations are factual (what happened). The self-debrief is reflective (what was hard). The retrospective agent uses both but treats them differently.

### Observation Inheritance

The `observations` flag inherits downward and cannot be disabled at a lower level:
- If a container enables `observations: true`, all its steps collect observations regardless of their own setting
- A step can enable `observations: true` even if its parent doesn't
- Resolution: `observations = own setting OR any ancestor's setting`

This avoids confusion at varied depths — set it on the stage, everything underneath collects.

## Retrospective Agent & Learning Router

### Inputs

- Raw observations from the stage agent
- Code diff from the stage's commits
- Current living doc for the stage
- Current skill the stage agent used
- Current agent definition of the stage agent

### Learning Taxonomy

Every learning is classified into exactly one category and routed to exactly one destination:

| Category | Routes to | Decision test |
|---|---|---|
| **Process** | `.claude/skills/{skill}/SKILL.md` (direct edit) | Would a different agent still need to follow this? |
| **Behavioral** | `.claude/agents/{agent}.md` (direct edit) | Would the same agent need this even on a different process? |
| **Domain** | `docs/stages/{stage}.md` (living doc) | Is this project-specific, not generalizable? |

Every learning gets exactly one destination. No duplicates across targets.

### Retrospective Report

The retrospective agent presents a structured report for human approval:

```
Retrospective Report — {stage_name} Stage (Feature: {feature_title})

Learning 1: [{category}]
  Observation: "{raw observation text}"
  Proposed change: "{specific text to add/modify}"
  Target: {file path of skill, agent def, or living doc}

Learning 2: ...

Actions: [Approve All] [Approve individually] [Reject All] [Edit]
```

The human reviews each learning, can edit proposed change text, approve or reject individually. Only approved changes are applied.

### Duplicate Detection & Escalation

When a proposed learning already exists in the target, it means the original learning is not being effective. The retrospective agent detects this and recommends an escalation path, starting with the simplest fix:

1. **Reword** — make it clearer/more specific, keep same location
2. **Strengthen** — make it actionable with concrete steps
3. **Relocate** — move up from living doc → skill → agent definition
4. **Escalate** — promote to a higher enforcement level

Escalation chain: **Living doc → Skill → Agent definition**. Each level is harder for agents to ignore.

The human always controls which action to take. The retrospective agent recommends reword first. Recurrence tracking and automatic escalation recommendations are a phase-2 enhancement — for phase 1, simple duplicate detection with human-facing options is sufficient.

### Safeguards

Before applying any change, the retrospective agent verifies:
- Learning doesn't already exist in the target (trigger escalation if it does)
- Similar learning doesn't exist in a different target (no cross-contamination)
- Classification is correct (process changes go to skills, behavioral to agent defs)

## Implement Stage: Multi-Service Features

The Implement stage is a container with three steps (Code, Test, Integration), each with its own agent:

1. **Code step**: Dispatcher reads feature services from MC (`get_feature_services`). `parallel: true` dispatches `svelte-architect` and `senior-code-architect-PY` concurrently. Backend goes first if sequential execution is needed.
2. **Test step**: `test-runner` runs all test suites impartially. On failure, loops back to Code with failure report.
3. **Integration step** (`condition: multi-service-only`): `integration-tester` starts the local stack and runs Playwright CLI verification. On failure, loops back to Code. Requires human approval.

Both Test and Integration loop back to Code on failure — the code-writing agents get the failure context and fix the actual problem.

All steps share Implement's retrospective and living doc. Test and integration failures feed back into how agents implement next time.

For single-service features, only Code and Test steps execute. Integration is skipped via `condition: multi-service-only`.

### Design-to-Implementation Bridge

The Design stage handles the full journey from idea to actionable plan:

1. **Brainstorm step** — design agent works with the human to produce a feature brief (what to build, API contracts, shared decisions). Stored as MC artifact.
2. **Plan step** — repo-scoped subagents read the feature brief + their own codebase and write implementation plans. Each plan lives in its repo (`{repo}/docs/plans/`). For multi-service features, agents run in parallel and only see their own repo.
3. **Plan Review step** — code-reviewer reads both plans together, checks API contract alignment, sequencing, and contradictions. Loops back to Plan if issues found. Human approves final plans.

This replaces the previous `cross-repo-planning` skill flow with a structured, agent-driven process.

## Error Handling & Recovery

### Stage agent failure

If a stage agent crashes, times out, or produces invalid output:
1. Dispatcher sets MC stage status to `failed`
2. Presents failure details to the human
3. Human decides: retry the stage, skip it, or abort the feature
4. No automatic retries — the human is always in control

### Parallel execution partial failure

If one service agent succeeds and the other fails during `parallel: true`:
1. The successful agent's work is preserved (committed to its branch)
2. The failed agent's partial work is reported but not committed
3. Human decides: retry the failed service, roll back the successful one, or continue with partial implementation

### Retrospective failure

The retrospective is non-blocking for the pipeline. If the retrospective agent fails:
1. Log the failure
2. Record a "retrospective-skipped" artifact with the reason
3. The pipeline can still advance — retrospective failure should not block feature delivery
4. Human is notified and can manually trigger retrospective later

### Zero learnings / all rejected

A retrospective report with zero approved learnings is a valid `retrospective-report` artifact. The report documents that retrospection occurred and found nothing actionable.

### Mission Control unavailability

If MC is unreachable:
1. The dispatcher cannot determine current stage — halt and notify human
2. Stage work that's already in progress continues (agents don't depend on MC mid-execution)
3. POST-STAGE artifact storage is retried when MC comes back

## Integration Tester — Deferred Detail

The integration-tester is the most infrastructure-heavy agent. Its full specification (stack startup commands, Clerk auth strategy in local/test context, integration test scenario registry, teardown process) requires a separate design spec scoped to the Median Code stack.

For this spec, the contract is:
- **Input**: Implementation commits from both services, feature description
- **Output**: `integration-report` artifact with pass/fail per flow, evidence (screenshots/logs)
- **Tool**: Playwright CLI (not MCP)
- **Trigger**: Only for multi-service features, after both agents complete

The detailed integration testing design will be a follow-up spec before the integration-tester agent is built.

## Skill & Agent Ownership Model

All skills and agent definitions are copied into the project and owned locally:

```
.claude/
  agents/             # All agent definitions (ours + copied from marketplace/official)
  skills/             # All skills (ours + copied from official)
```

**The project is the source of truth.** The retrospective modifies these files directly — no overlay system, no fork mechanism, no special cases for "ours vs theirs."

### Why local copies

- Skills and agents from official sources or marketplaces can be updated upstream at any time
- If learnings were applied as overlays, upstream updates could silently conflict with accumulated learnings
- Local copies give full control: learnings edit the file directly, and upstream updates are opt-in

### Upstream sync

When an official skill or marketplace agent updates:
1. A maintenance check detects the upstream change (can be manual or automated)
2. Presents a diff to the human: "brainstorming skill updated upstream. Changes: X, Y, Z"
3. Human decides: merge the update, skip it, or cherry-pick specific changes
4. Accumulated learnings are preserved because they're already in the local copy

Updates are opt-in. We pull upstream changes when we want, not when they're pushed.

## Versioning & Concurrency

Retrospective-approved changes are committed to git, making them versioned and revertable. If a learning turns out to be harmful, `git revert` the commit.

Concurrent retrospectives (two features completing stages simultaneously) are serialized — only one retrospective runs at a time. The dispatcher queues retrospective runs and executes them sequentially to avoid conflicting writes to shared files (skills, agent defs, living docs).

## Agent Inventory

All agents live in `.claude/agents/` as local copies under project control.

| Agent | Source | Purpose | Key constraint |
|---|---|---|---|
| `svelte-architect` | Existing (copy to local) | Frontend implementation | Add observation contract, no other changes |
| `senior-code-architect-PY` | Existing (copy to local) | Backend implementation | Add observation contract, no other changes |
| `design-agent` | New | Runs brainstorming, produces design specs | Must NOT write code |
| `test-runner` | New | Runs test suites, reports results | Must NOT fix failing tests |
| `code-reviewer` | New | Reviews implementation against spec | Must NOT modify code |
| `integration-tester` | New | Browser automation against local stack | Domain-specific to Median Code stack |
| `retrospective-agent` | New | Classifies learnings, proposes changes | Applies only human-approved changes |

Agent definitions start minimal (~5-10 lines). Identity, hard constraints, output contract. The retrospective system grows them organically based on real problems encountered.

## Stage Skills (Two-Tier Model)

There are two tiers of skills:

1. **Stage skills** (`stage--*`) — orchestration wrappers invoked by the dispatcher. They handle reading living docs, constructing agent prompts, collecting observations, and returning results. The dispatcher always invokes a stage skill.
2. **Execution skills** (referenced in YAML `skill` field) — the actual workflow the agent follows (e.g., `brainstorming`, `executing-plans`). The stage skill injects the execution skill into the agent's prompt.

| Stage Skill | Execution Skill | Purpose |
|---|---|---|
| `stage--design` | `brainstorming`, `writing-plans`, `plan-review` | Orchestrates Design: recurse through Brainstorm/Plan/Plan Review steps |
| `stage--implement` | `executing-plans`, `running-tests`, `integration-testing` | Orchestrates Implement: recurse through Code/Test/Integration steps, handle loop-backs |
| `stage--review` | `requesting-code-review` | Orchestrates Review: dispatch code-reviewer, handle loop-back to Implement |
| `stage--release` | — | Orchestrates Release: present deployment checklist to human |
| `retrospective` | — | Classification taxonomy, duplicate detection, escalation, report format |
| `integration-testing` | — | Integration test process: stack setup, Playwright CLI flows, evidence collection |

Additionally, `dispatch-pipeline` is rewritten to become the central lifecycle controller implementing the PRE-STAGE / EXECUTE / POST-STAGE loop.

## Project Structure

```
.claude/
  agents/                 # All agent definitions (local copies, retrospective edits these)
    svelte-architect.md
    senior-code-architect-PY.md
    design-agent.md
    test-runner.md
    code-reviewer.md
    integration-tester.md
    retrospective-agent.md
  skills/                 # All skills (local copies, retrospective edits these)
    stage--design/
    stage--implement/
    stage--review/
    stage--release/
    retrospective/
    integration-testing/
    dispatch-pipeline/
    cross-repo-planning/
    ...                   # execution skills (brainstorming, executing-plans, etc.)

docs/
  stages/
    design.md             # Living doc for Design stage
    implement.md          # Living doc for Implement stage
    review.md             # Living doc for Review stage
    release.md            # Living doc for Release stage
  retrospective.md        # Pipeline-level retrospective living doc
  specs/                  # Design specs (orchestrator-level)
    completed/            # Specs move here when feature is released
```

- **Backlog** lives in GitHub Issues (Backlog column on project board)
- **Design specs** live in `orchestrator/docs/specs/`, move to `docs/specs/completed/` when released
- **Implementation plans** live in `{repo}/docs/plans/`, move to `{repo}/docs/plans/completed/` when released
- MC artifacts point to file paths

## GitHub Project Board

Columns match pipeline stages plus pre/post states:

**Backlog → Design → Implement → Review → Release → Done**

Retrospective is not a board column. It's tracked as artifacts and comments on the feature's GitHub Issue.

## What This System Produces Over Time

1. Living docs accumulate domain knowledge per stage
2. Skills become more precise about process steps
3. Agent definitions become more specific about behavioral patterns
4. Problems that recur get escalated from suggestions to hard rules
5. The human controls every change via retrospective approval
6. Trust builds, autonomy modes can be relaxed stage by stage
