# Passive Observation Collection — Orchestrator Usage Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the orchestrator's agent definitions, commit command, and dispatch pipeline to use `mc observation add` and `mc observation consolidate` for automatic observation collection.

**Architecture:** Agent definitions and skills get instruction text that triggers `mc observation add` calls. The dispatch pipeline calls `mc observation consolidate` after each subagent returns.

**Tech Stack:** Markdown instruction files

**Spec:** Located in MC repo: `~/Documents/Projects/mission-control/docs/work/passive-observation-collection/spec.md`

**Prerequisite:** MC observation commands must be implemented first (see MC plan).

---

## Chunk 1: New Files

### Task 1: Create orchestrator observation and learnings files

**Files:**
- Create: `pipelines/software-dev/observations/orchestrate.md`
- Create: `pipelines/software-dev/learnings/orchestrate.md`

- [ ] **Step 1: Create `orchestrate.md` observation file**

Write `pipelines/software-dev/observations/orchestrate.md`:

```markdown
# Orchestrate — Observations

_Meta-observations about pipeline execution: dispatch failures, agent crashes, coordination friction. "Orchestrate" is not a pipeline stage — it is a scope for observations about the pipeline itself._
```

- [ ] **Step 2: Create `orchestrate.md` learnings file**

Write `pipelines/software-dev/learnings/orchestrate.md`:

```markdown
# Orchestrate — Learnings

## Patterns

## Anti-Patterns
```

- [ ] **Step 3: Commit**

```
docs(pipeline): add orchestrator observation and learnings files

- Add orchestrate.md to observations/ for dispatch/coordination issues
- Add orchestrate.md to learnings/ for retrospective consolidation
```

## Chunk 2: Commit Command

### Task 2: Add observation check to `/commit` command

**Files:**
- Modify: `.claude/commands/commit.md:73-75`

- [ ] **Step 1: Insert Observation Check section**

In `.claude/commands/commit.md`, replace lines 73-75 (the entire "After Committing" section) with:

```markdown
## Observation Check

Before resuming your task, briefly assess: did completing this task involve
any of the following that you have NOT already recorded an observation for?

- **PROBLEM**: Something broke unexpectedly, requiring a fix not anticipated by the plan
- **DECISION**: A judgment call between alternatives that could affect future work
- **FRICTION**: Something harder than it should have been — missing abstraction, unclear convention, tool limitation, or workaround

If YES to any: record one observation per issue using:

```bash
mc observation add <feature_id> <stage> --scope <scope> --category <CAT> \
  --title "..." --detail "..." --resolution "..." \
  --agent-name <agent> --dispatch-id <id> --attempt <n>
```

If NO: resume immediately. Do not record anything. Do not mention that you checked.

## After Committing

**This commit is part of a larger task.** After the observation check, immediately return to your previous task and continue execution. Do NOT stop, do NOT consider your work done, do NOT wait for approval. Resume the `autonomous-executing-plans` workflow from where you left off.
```

- [ ] **Step 2: Verify the ordering**

Read `.claude/commands/commit.md` and confirm "Observation Check" appears before "After Committing".

- [ ] **Step 3: Commit**

```
feat(config): add observation check to commit command

- Insert observation check between commit completion and resume instruction
- Agents assess PROBLEM/DECISION/FRICTION after each commit via mc observation add
```

## Chunk 3: Agent Definitions

### Task 3: Add observation triggers to `svelte-architect`

**Files:**
- Modify: `.claude/agents/svelte-architect.md` (before Output Contract)

- [ ] **Step 1: Add Immediate Observation Triggers section**

Insert before `## Output Contract`:

```markdown
## Immediate Observation Triggers

If any of these occur during your work, record an observation IMMEDIATELY using `mc observation add`, before your next tool call:

- The same error or test failure has occurred more than twice
- You must significantly deviate from the plan to proceed
- A skill instruction, tool, or prompt is broken or misleading
- You are making a decision that changes a shared rule or cross-feature approach
- You are about to return with incomplete work or unresolved blockers

Do not wait for a commit. Record the observation now, then continue working.

After each `/commit`, the commit skill will prompt you for a separate observation check. Before returning results (success or failure), perform one final observation check.
```

- [ ] **Step 2: Commit**

```
feat(agents): add observation triggers to svelte-architect

- Add immediate-write triggers for mid-task problems
- Reference commit-boundary and final checkpoint
```

### Task 4: Add observation triggers to `senior-code-architect-PY`

**Files:**
- Modify: `.claude/agents/senior-code-architect-PY.md` (before Output Contract)

- [ ] **Step 1: Add same Immediate Observation Triggers section**

Insert before `## Output Contract`, same text as Task 3 (identical content).

- [ ] **Step 2: Commit**

```
feat(agents): add observation triggers to senior-code-architect-PY

- Add immediate-write triggers for mid-task problems
- Reference commit-boundary and final checkpoint
```

### Task 5: Add observation triggers to `code-reviewer`

**Files:**
- Modify: `.claude/agents/code-reviewer.md` (after Output Contract)

- [ ] **Step 1: Add Observation Triggers section**

Append after Output Contract:

```markdown
## Observation Triggers

The code-reviewer never commits, so the commit-boundary observation check does not apply. Instead:

**During review:** If any of these occur, record an observation IMMEDIATELY using `mc observation add`:

- A skill instruction, tool, or prompt is broken or misleading
- You are making a judgment call that could affect future reviews
- A pattern mismatch reveals a systemic issue beyond the current review scope

**Before returning results:** Perform a final observation check — assess whether you encountered any PROBLEM, DECISION, or FRICTION worth recording.
```

- [ ] **Step 2: Commit**

```
feat(agents): add observation triggers to code-reviewer

- Add immediate-write triggers for review-time issues
- Add before-returning-results final checkpoint
```

## Chunk 4: Skills

### Task 6: Add observation triggers to `autonomous-executing-plans`

**Files:**
- Modify: `.claude/skills/autonomous-executing-plans/SKILL.md` (between Step 2 and Step 3)

- [ ] **Step 1: Insert Observation Triggers section**

Insert after line 31 (end of Step 2 task loop), before `### Step 3: Final Verification`:

```markdown

### Observation Triggers (Always Active)

Throughout execution, if any of these occur, record an observation IMMEDIATELY using `mc observation add`:

- The same error or test failure has occurred more than twice
- You must significantly deviate from the plan to proceed
- A skill instruction, tool, or prompt is broken or misleading
- You are making a decision that changes a shared rule or cross-feature approach

The `/commit` skill will also prompt an observation check after each commit. Before returning final results, perform one last observation check.
```

- [ ] **Step 2: Commit**

```
feat(config): add observation triggers to autonomous-executing-plans

- Add always-active observation trigger section to execution loop
```

### Task 7: Add consolidation and dispatch metadata to `orch--dispatch-pipeline`

**Files:**
- Modify: `.claude/skills/orch--dispatch-pipeline/SKILL.md`

- [ ] **Step 1: Add dispatch metadata to Plan stage agent prompts**

Replace lines 47-53 (the FE/BE agent descriptions in Write Plans):

```markdown
**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Prompt: Plan Writing template with `{feature_spec_content}` injected
- Include in prompt: `feature_id: "{feature_id}"`, `dispatch_id: "fe-plan-{feature_slug}-{attempt}"`, `attempt: {attempt_number}`, `stage: "plan"`, `feature: "{feature_slug}"`
- Output: `docs/work/{feature_slug}/plan-frontend.md`

**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Prompt: Plan Writing template with `{feature_spec_content}` injected
- Include in prompt: `feature_id: "{feature_id}"`, `dispatch_id: "be-plan-{feature_slug}-{attempt}"`, `attempt: {attempt_number}`, `stage: "plan"`, `feature: "{feature_slug}"`
- Output: `docs/work/{feature_slug}/plan-backend.md`
```

- [ ] **Step 2: Add consolidation step after Plan "Write Plans" completes**

After the Plan "Write Plans" completion block (after `mc step update ... completed`), insert:

```markdown

**Collect Observations:**

```bash
mc observation consolidate {feature_id} \
  --output-dir pipelines/software-dev/observations/ \
  --feature-title "{feature_title}"
```

If observations were written, commit the updated observation files.
```

- [ ] **Step 3: Add dispatch metadata to Implement stage**

After line 105 ("Dispatch scoped agents in parallel..."), insert:

```markdown

**Include in each dispatch prompt:**
- Frontend: `feature_id: "{feature_id}"`, `dispatch_id: "fe-implement-{feature_slug}-{attempt}"`, `attempt: {attempt_number}`, `stage: "implement"`, `feature: "{feature_slug}"`
- Backend: `feature_id: "{feature_id}"`, `dispatch_id: "be-implement-{feature_slug}-{attempt}"`, `attempt: {attempt_number}`, `stage: "implement"`, `feature: "{feature_slug}"`
```

- [ ] **Step 4: Add consolidation step after Implement "Code" completes**

After the Implement "Code" completion block, insert the same consolidation command as Step 2.

- [ ] **Step 5: Add consolidation to error handling**

In the Error Handling section, append:

```markdown
- After any agent crash or failure: run `mc observation consolidate` before retrying. Crashed agents may have recorded immediate-write observations.
- Record an orchestrator observation for any crash: `mc observation add {feature_id} {stage} --scope orch --category PROBLEM --title "..." --detail "..." --resolution "..." --agent-name orchestrator`
```

- [ ] **Step 6: Commit**

```
feat(pipeline): add observation consolidation to dispatch pipeline

- Inject dispatch metadata into all subagent dispatch prompts
- Add mc observation consolidate call after each stage step
- Add crash-recovery observation collection to error handling
```

## Chunk 5: Verification

### Task 8: End-to-end verification

- [ ] **Step 1: Verify all agent definitions have observation triggers**

Grep for "observation" across agent definitions:

Run: `grep -l "Observation" .claude/agents/*.md`
Expected: `svelte-architect.md`, `senior-code-architect-PY.md`, `code-reviewer.md`

- [ ] **Step 2: Verify commit command has observation check before resume**

Read `.claude/commands/commit.md` and confirm "Observation Check" section appears before "After Committing".

- [ ] **Step 3: Verify dispatch pipeline has consolidation and metadata**

Read `.claude/skills/orch--dispatch-pipeline/SKILL.md` and confirm:
- `dispatch_id` and `feature_id` in both Plan and Implement dispatch prompts
- `mc observation consolidate` after both Write Plans and Code completion
- Crash observation in error handling

- [ ] **Step 4: Verify new files exist**

Run: `ls pipelines/software-dev/observations/orchestrate.md pipelines/software-dev/learnings/orchestrate.md`
Expected: Both exist

- [ ] **Step 5: If any fixes needed, commit them**
