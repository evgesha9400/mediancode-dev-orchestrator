---
name: orch--subagent-driven-development
description: Execute plan by dispatching fresh subagent per task on the current branch (no worktrees, no feature branches). Two-stage review after each task.
---

# Subagent-Driven Development (Orchestrator Override)

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance first, then code quality.

**This is the orchestrator-adapted version of `superpowers:subagent-driven-development`.** Key differences from the upstream skill:
- **No worktrees** — banned project-wide (stale branches, orphaned index files)
- **No feature branches** — work directly on the current branch
- **Uses `/commit` skill** — never raw `git commit` commands
- **Scoped to mission-control repo** — subagents work in `~/Documents/Projects/mission-control`
- **Includes Serena code navigation** — subagents get MCP tool instructions

## Core Principle

Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration. Subagents never inherit your session context — you construct exactly what they need.

## The Process

1. Read plan, extract all tasks with full text, create TodoWrite
2. For each task:
   a. Dispatch implementer subagent (see prompt template below)
   b. If implementer asks questions → answer and re-dispatch
   c. Implementer implements, tests, commits (using /commit), self-reviews
   d. Dispatch spec reviewer subagent
   e. If spec issues → implementer fixes → re-review
   f. Dispatch code quality reviewer subagent
   g. If quality issues → implementer fixes → re-review
   h. Mark task complete in TodoWrite
3. After all tasks: dispatch final code reviewer for entire implementation
4. Report completion to user

## Git Policy — MANDATORY

- **Work on the current branch.** Do NOT create feature branches or worktrees.
- **Use `/commit` for all commits.** Never use raw `git commit`.
- **Sequential dispatch only.** Never dispatch two write-enabled subagents simultaneously (shared .git index).
- **Subagents commit their own work.** The orchestrator does not commit on behalf of subagents.

## Model Selection

- **Mechanical tasks** (isolated functions, clear specs, 1-2 files): use `model: "sonnet"` or `model: "haiku"`
- **Integration tasks** (multi-file coordination, pattern matching): use default model
- **Review tasks**: use `model: "opus"` for thorough review

## Handling Implementer Status

- **DONE:** Proceed to spec compliance review
- **DONE_WITH_CONCERNS:** Read concerns. If correctness/scope, address before review. If observations, note and proceed.
- **NEEDS_CONTEXT:** Provide missing context and re-dispatch
- **BLOCKED:** Assess blocker: provide more context, re-dispatch with more capable model, break into smaller pieces, or escalate to human

## Implementer Prompt Template

```
Agent tool (general-purpose or senior-code-architect-PY):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Working Directory

    You are working in the mission-control repo: ~/Documents/Projects/mission-control
    Run all commands from this directory. Use `poetry run pytest` for tests.

    ## Code Navigation Tools

    You have access to Serena MCP tools for semantic code analysis. PREFER these over built-in tools:
    - `mcp__plugin_serena_serena__find_symbol` — find a class/function/method by name
    - `mcp__plugin_serena_serena__find_referencing_symbols` — find all references to a symbol
    - `mcp__plugin_serena_serena__get_symbols_overview` — understand file structure (classes, methods)
    - `mcp__plugin_serena_serena__replace_symbol_body` — replace a function/method body
    - `mcp__plugin_serena_serena__replace_content` — targeted regex/string replacement within files
    - `mcp__plugin_serena_serena__insert_after_symbol` / `insert_before_symbol` — insert code relative to a symbol
    Use Grep/Glob/Read only for non-code searches (string literals, config values, file names).
    Decision rule: if the target is a code symbol, use Serena. If it is a text string, use Grep.

    ## Task Description

    [FULL TEXT of task from plan — paste it here, never make subagent read the plan file]

    ## Context

    [Scene-setting: where this fits, what was done in prior tasks, dependencies]

    Spec: ~/Documents/Projects/mission-control/docs/work/observer-daemon-learnings/spec.md
    (Read only the relevant section if you need clarification — do not read the whole spec.)

    ## Before You Begin

    If you have questions about requirements, approach, dependencies, or anything unclear — ask now.

    ## Your Job

    1. Implement exactly what the task specifies
    2. Write tests (TDD: failing test first, then implementation)
    3. Run: `cd ~/Documents/Projects/mission-control && poetry run pytest -v`
    4. Verify ALL tests pass (including pre-existing ones)
    5. Commit using the /commit skill (NEVER use raw git commit)
    6. Self-review (completeness, quality, discipline, testing)
    7. Report back

    ## Commit Policy

    ALWAYS use the /commit skill. Never write raw `git commit` commands.

    ## Code Organization

    - Follow the file structure defined in the plan
    - Each file should have one clear responsibility
    - Follow existing patterns in mc/ (see observations.py, dispatches.py for style)
    - If a file grows beyond plan's intent, report as DONE_WITH_CONCERNS

    ## Report Format

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented
    - What you tested and test results
    - Files changed
    - Self-review findings
    - Any concerns
```

## Spec Reviewer Prompt Template

```
Agent tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements from plan]

    ## What Implementer Claims They Built

    [From implementer's report]

    ## Working Directory

    ~/Documents/Projects/mission-control

    ## Code Navigation Tools

    You have access to Serena MCP tools for semantic code analysis. PREFER these over built-in tools:
    - `mcp__plugin_serena_serena__find_symbol` — find a class/function/method by name
    - `mcp__plugin_serena_serena__find_referencing_symbols` — find all references to a symbol
    - `mcp__plugin_serena_serena__get_symbols_overview` — understand file structure
    Use Grep/Glob/Read only for non-code searches.

    ## CRITICAL: Do Not Trust the Report

    Verify everything independently by reading the actual code.

    Check for:
    - **Missing requirements** — did they skip anything?
    - **Extra work** — did they build things not requested?
    - **Misunderstandings** — did they solve the wrong problem?

    Report:
    - APPROVED: Spec compliant (all requirements met, nothing extra)
    - ISSUES: [list specifically what's missing or extra, with file:line references]

    Do NOT make any code changes.
```

## Code Quality Reviewer Prompt Template

```
Agent tool (superpowers:code-reviewer):
  description: "Review code quality for Task N"

  Use the superpowers:requesting-code-review skill with:
  - WHAT_WAS_IMPLEMENTED: [from implementer's report]
  - PLAN_OR_REQUIREMENTS: Task N from the plan
  - BASE_SHA: [commit before task]
  - HEAD_SHA: [current commit]
  - DESCRIPTION: [task summary]

  Additional checks:
  - Does each file have one clear responsibility?
  - Does the implementation follow existing mc/ patterns?
  - Are tests in tests/ following the conftest.py fixture pattern?
  - Is the code formatted with black?

  Do NOT make any code changes.
```

## Red Flags

- **Never** skip reviews (spec compliance OR code quality)
- **Never** dispatch multiple implementation subagents in parallel
- **Never** use git worktrees or create feature branches
- **Never** use raw `git commit` — always use /commit skill
- **Never** make subagent read the plan file — provide full text inline
- **Never** proceed with unfixed issues from review

## After All Tasks

After all tasks are complete and reviewed:
1. Run full test suite: `cd ~/Documents/Projects/mission-control && poetry run pytest -v`
2. Dispatch a final code reviewer subagent for the entire implementation
3. Report completion to the user with a summary of all tasks completed
