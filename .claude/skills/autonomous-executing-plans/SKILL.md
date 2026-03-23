---
name: autonomous-executing-plans
description: Execute an implementation plan autonomously without stopping for human approval — for use by dispatched subagents
---

# Autonomous Executing Plans

## Overview

Load plan, execute all tasks sequentially, commit after each, return results when complete.

This skill is for **subagents dispatched by the orchestrator**. There is no human to interact with. Execute autonomously from start to finish.

## The Process

### Step 1: Load Plan
1. Read the plan file
2. Identify which tasks are already completed (check git log if told which tasks are done)
3. Create a TodoWrite task list for remaining tasks
4. Proceed immediately — do NOT raise concerns or ask questions

### Step 2: Execute Tasks

For each task, in order:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps with inline code)
3. Run verifications as specified (tests, type checks, etc.)
4. If a verification fails: attempt to fix it. If you cannot fix it after 2 attempts, note it and continue to the next task
5. Commit the task using `/commit`
6. Mark as completed
7. **Immediately proceed to the next task — do NOT pause, do NOT wait for approval**

### Step 3: Final Verification

After all tasks are complete:
1. Run the full test suite
2. Report results

### Step 4: Archive Plans

After verification passes, invoke `archive-initiative` to move the initiative's work plans to `docs/work/completed/`.

**Do NOT:**
- Use superpowers:finishing-a-development-branch
- Use superpowers:using-git-worktrees (project-wide ban — all repos, not just frontend)
- Use superpowers:subagent-driven-development
- Stop to ask for human input
- Present options and wait for a choice
- Suggest switching to a different skill

## Error Handling

- If a test fails after implementation: try to fix it (up to 2 attempts)
- If a dependency is missing: note it and continue with remaining tasks
- If an instruction is unclear: make your best interpretation and note the ambiguity
- **Never stop and wait** — always continue or return with results

## Output

When complete, return:
- List of completed tasks with commit SHAs
- Any tasks that could not be completed and why
- Final test results
