---
name: orch--writing-plans
description: Write implementation plans for the orchestrator project — saves to docs/work/{initiative}/, uses /commit, no worktrees, references orch--subagent-driven-development
---

# Writing Plans (Orchestrator Override)

Write comprehensive implementation plans. This overrides `superpowers:writing-plans` for the orchestrator project.

**Differences from upstream:**
- **Save location:** `docs/work/{initiative-name}/plan.md` (per CLAUDE.md docs structure rules, NOT `docs/superpowers/plans/`)
- **No worktrees:** Work on current branch directly
- **Uses `/commit`:** Never raw `git commit`
- **References `orch--subagent-driven-development`:** Not the upstream `superpowers:subagent-driven-development`
- **MC repo context:** Plans for mission-control include Poetry commands, mc/ module patterns

**Announce at start:** "I'm using the orch--writing-plans skill to create the implementation plan."

## Scope Check

If the spec covers multiple independent subsystems, suggest breaking into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for.

- Design units with clear boundaries and well-defined interfaces
- Each file should have one clear responsibility
- Follow existing patterns in the target repo (e.g., `mc/observations.py` patterns for mission-control)
- Prefer smaller, focused files over large ones

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit using /commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use orch--subagent-driven-development (recommended) or autonomous-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Projects/mission-control && poetry run pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/Projects/mission-control && poetry run pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

Use the /commit skill. NEVER write raw `git commit` commands.
````

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output (use `poetry run pytest` for MC, `bun run` for frontend)
- Use /commit skill for all commits — never raw git commit
- DRY, YAGNI, TDD, frequent commits

## Plan Review Loop

After writing the complete plan:

1. Dispatch a plan-document-reviewer subagent with:
   - Path to the plan document
   - Path to the spec document
   - Instruction to verify plan covers spec requirements and tasks are actionable
2. If issues found: fix and re-dispatch (max 3 iterations)
3. If approved: proceed to execution handoff

## Plan Review Prompt Template

```
Agent tool (general-purpose):
  description: "Review plan document"
  prompt: |
    You are a plan document reviewer. Verify this plan is complete and ready for implementation.

    **Plan to review:** [PLAN_FILE_PATH]
    **Spec for reference:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, incomplete tasks, missing steps |
    | Spec Alignment | Plan covers spec requirements, no major scope creep |
    | Task Decomposition | Tasks have clear boundaries, steps are actionable |
    | Buildability | Could an engineer follow this plan without getting stuck? |

    ## Calibration

    Only flag issues that would cause real problems during implementation.
    Approve unless there are serious gaps.

    ## Output Format

    **Status:** Approved | Issues Found
    **Issues (if any):**
    - [Task X, Step Y]: [specific issue] - [why it matters]
    **Recommendations (advisory):**
    - [suggestions]
```

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `docs/work/{initiative}/plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using autonomous-executing-plans, batch execution

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use `orch--subagent-driven-development`
- Fresh subagent per task + two-stage review
- Work on current branch, no worktrees

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use `autonomous-executing-plans`
- Batch execution, commit after each task using /commit
