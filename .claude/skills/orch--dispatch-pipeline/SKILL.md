---
name: orch--dispatch-pipeline
description: Use when starting work on a feature — creates it in Mission Control, registers services, and orchestrates the plan→verify→implement→verify flow
---

# Dispatch Pipeline

## When to Use

When starting work on a feature that should flow through the delivery pipeline.

## Prerequisites

One-time setup (skip if already done — check with `mc pipeline create --file pipelines/software-dev.yaml`):

```bash
mc service register frontend --path ./frontend --stack sveltekit
mc service register backend --path ./backend --stack fastapi
mc pipeline create --file pipelines/software-dev.yaml
```

## Process

### 1. Create Feature

```bash
mc feature create --title "{feature_title}" --pipeline {pipeline_id}
mc service link {feature_id} frontend
mc service link {feature_id} backend
mc feature get {feature_id}
```

### 2. Plan Stage

```bash
mc step update {feature_id} Plan --status in_progress
```

**Step: Write Plans**

```bash
mc step update {feature_id} Plan "Write Plans" --status in_progress
```

Dispatch two scoped agents sequentially (or in parallel if using Agent tool with multiple calls):

**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Prompt: Plan Writing template (see design spec) with `{feature_spec_content}` injected
- Output: `docs/work/{feature_slug}/plan-frontend.md`

**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Prompt: Plan Writing template with `{feature_spec_content}` injected
- Output: `docs/work/{feature_slug}/plan-backend.md`

After both complete:

```bash
mc service status {feature_id} frontend --status completed
mc service status {feature_id} backend --status completed
mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content docs/work/{feature_slug}/plan-frontend.md
mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content docs/work/{feature_slug}/plan-backend.md
mc step update {feature_id} Plan "Write Plans" --status completed
```

**Step: Plan Review**

```bash
mc step update {feature_id} Plan "Plan Review" --status in_progress
```

Dispatch `code-reviewer` agent (global scope — sees both repos):
- Prompt: Global Verifier template with both plans + original spec
- Output: PASS/FAIL per contract point

**If FAIL:**
```bash
mc step update {feature_id} Plan "Write Plans" --status in_progress
mc service status {feature_id} frontend --status in_progress
mc service status {feature_id} backend --status in_progress
```
Re-dispatch Write Plans agents with review feedback appended. Loop until PASS.

**If PASS:**
```bash
mc artifact add {feature_id} Plan --step "Plan Review" --type plan-review-report --content {report_path}
mc step update {feature_id} Plan "Plan Review" --status completed
mc step update {feature_id} Plan --status completed
```

**Stage Gate — ask user for approval.** Present plan summary and wait for confirmation.

```bash
mc feature advance {feature_id} --approved
```

### 3. Implement Stage

Same pattern as Plan:

```bash
mc step update {feature_id} Implement --status in_progress
mc step update {feature_id} Implement Code --status in_progress
```

Dispatch scoped agents in parallel with their respective plans as input.

After both complete:

```bash
mc service status {feature_id} frontend --status completed
mc service status {feature_id} backend --status completed
mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {frontend_sha}
mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {backend_sha}
mc step update {feature_id} Implement Code --status completed
```

**Step: Code Review** — same as Plan Review but checking actual code.

```bash
mc step update {feature_id} Implement "Code Review" --status in_progress
```

Dispatch `code-reviewer` (global). If FAIL, loop back to Code. If PASS:

```bash
mc artifact add {feature_id} Implement --step "Code Review" --type review-report --content {report_path}
mc step update {feature_id} Implement "Code Review" --status completed
mc step update {feature_id} Implement --status completed
```

**Stage Gate — ask user for approval.**

```bash
mc feature advance {feature_id} --approved
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
- If `mc feature advance` fails: show validation errors, do not advance
