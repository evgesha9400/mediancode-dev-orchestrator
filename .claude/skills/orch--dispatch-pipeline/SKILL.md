---
name: orch--dispatch-pipeline
description: Use when starting work on a feature — creates it in Mission Control, registers services, and orchestrates the plan→verify→implement→verify flow
---

# Dispatch Pipeline

## When to Use

When starting work on a feature that should flow through the delivery pipeline.

## Prerequisites

One-time setup (skip if already done — check with `bin/mc pipeline create --file pipelines/software-dev.yaml`):

```bash
bin/mc service register frontend --path ./frontend --stack sveltekit
bin/mc service register backend --path ./backend --stack fastapi
bin/mc pipeline create --file pipelines/software-dev.yaml
```

## Process

### 1. Create Feature

```bash
bin/mc feature create --title "{feature_title}" --pipeline {pipeline_id}
bin/mc service link {feature_id} frontend
bin/mc service link {feature_id} backend
bin/mc feature get {feature_id}
```

### 2. Plan Stage

```bash
bin/mc step update {feature_id} Plan --status in_progress
```

**Step: Write Plans**

```bash
bin/mc step update {feature_id} Plan "Write Plans" --status in_progress
```

Dispatch two scoped agents sequentially (or in parallel if using Agent tool with multiple calls):

**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} plan --service-name frontend --agent-name svelte-architect --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Plan Writing template with `{feature_spec_content}` injected + observation context block
- Output: `docs/work/{feature_slug}/plan-frontend.md`

**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} plan --service-name backend --agent-name senior-code-architect-PY --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Plan Writing template with `{feature_spec_content}` injected + observation context block
- Output: `docs/work/{feature_slug}/plan-backend.md`

After both complete:

**Verify dispatches finalized:**

```bash
bin/mc dispatch verify {fe_dispatch_id}
bin/mc dispatch verify {be_dispatch_id}
```

If either fails, the subagent did not finalize. Report to user.

```bash
bin/mc service status {feature_id} frontend --status completed
bin/mc service status {feature_id} backend --status completed
bin/mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content docs/work/{feature_slug}/plan-frontend.md
bin/mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content docs/work/{feature_slug}/plan-backend.md
bin/mc step update {feature_id} Plan "Write Plans" --status completed
```

**Collect Observations:**

```bash
bin/mc observation consolidate {feature_id} \
  --output-dir pipelines/software-dev/observations/ \
  --feature-title "{feature_title}"
```

If observations were written, commit the updated observation files.

**Step: Plan Review**

```bash
bin/mc step update {feature_id} Plan "Plan Review" --status in_progress
```

Dispatch `code-reviewer` agent (global scope — sees both repos):
- Prompt: Global Verifier template with both plans + original spec
- Output: PASS/FAIL per contract point

**If FAIL:**
```bash
bin/mc step update {feature_id} Plan "Write Plans" --status in_progress
bin/mc service status {feature_id} frontend --status in_progress
bin/mc service status {feature_id} backend --status in_progress
```
Re-dispatch Write Plans agents with review feedback appended. Loop until PASS.

**If PASS:**
```bash
bin/mc artifact add {feature_id} Plan --step "Plan Review" --type plan-review-report --content {report_path}
bin/mc step update {feature_id} Plan "Plan Review" --status completed
bin/mc step update {feature_id} Plan --status completed
```

**Stage Gate — ask user for approval.** Present plan summary and wait for confirmation.

```bash
bin/mc feature advance {feature_id} --approved
```

### 3. Implement Stage

Same pattern as Plan:

```bash
bin/mc step update {feature_id} Implement --status in_progress
bin/mc step update {feature_id} Implement Code --status in_progress
```

Dispatch scoped agents in parallel with their respective plans as input.

**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} implement --service-name frontend --agent-name svelte-architect --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Implementation template with plan content injected + observation context block

**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} implement --service-name backend --agent-name senior-code-architect-PY --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Implementation template with plan content injected + observation context block

After both complete:

**Verify dispatches finalized:**

```bash
bin/mc dispatch verify {fe_dispatch_id}
bin/mc dispatch verify {be_dispatch_id}
```

If either fails, the subagent did not finalize. Report to user.

```bash
bin/mc service status {feature_id} frontend --status completed
bin/mc service status {feature_id} backend --status completed
bin/mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {frontend_sha}
bin/mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {backend_sha}
bin/mc step update {feature_id} Implement Code --status completed
```

**Collect Observations:**

```bash
bin/mc observation consolidate {feature_id} \
  --output-dir pipelines/software-dev/observations/ \
  --feature-title "{feature_title}"
```

If observations were written, commit the updated observation files.

**Step: Code Review** — same as Plan Review but checking actual code.

```bash
bin/mc step update {feature_id} Implement "Code Review" --status in_progress
```

Dispatch `code-reviewer` (global). If FAIL, loop back to Code. If PASS:

```bash
bin/mc artifact add {feature_id} Implement --step "Code Review" --type review-report --content {report_path}
bin/mc step update {feature_id} Implement "Code Review" --status completed
bin/mc step update {feature_id} Implement --status completed
```

**Stage Gate — ask user for approval.**

```bash
bin/mc feature advance {feature_id} --approved
```

Feature is now complete.

## Agent Prompt Templates

See the pipeline orchestration design spec in the MC repo for the three prompt templates:
- Scoped Agent — Plan Writing
- Scoped Agent — Implementation
- Global Verifier

## Error Handling

- If a scoped agent fails: report to user, ask whether to retry or abort
- If Code Review fails: loop back to Code step with feedback
- If Plan Review fails: loop back to Write Plans step with feedback
- If `bin/mc feature advance` fails: show validation errors, do not advance
- After any agent crash or failure: run `bin/mc observation consolidate` before retrying. Crashed agents may have recorded immediate-write observations.
- Record an orchestrator observation for any crash: `bin/mc observation add {feature_id} {stage} --scope orch --category PROBLEM --title "..." --detail "..." --resolution "..." --agent-name orchestrator`
