# Session Instructions

## Skill Naming Convention — MANDATORY

Skills are prefixed to indicate who should load and use them:
- `fe--*` — Frontend agents only
- `be--*` — Backend agents only
- `orch--*` — Orchestrator agent only
- No prefix — Shared, usable by any agent (orchestrator, frontend, backend)

Agents MUST only load skills matching their scope. The prefix acts as a filter — if the prefix doesn't match your role, do not load the skill.

## Test Policy

Always ensure all tests pass, even if failures are pre-existing. If it is unclear whether to fix the application code or update the tests, provide a report of the errors found and ask the user before making changes.

## Commit Policy — MANDATORY

**ALWAYS use the `/commit` skill when creating git commits.** Never write raw `git commit` commands. This applies in ALL contexts: main repo, plan execution, subagent work — no exceptions.

## Frontend: Bun Hardlinks — MANDATORY

**NEVER use `rm -rf` or git worktrees in the frontend repo.** Bun's hardlinked `node_modules` breaks both. Use `find <dir> -delete` for directory removal and feature branches instead of worktrees. See `fe--delete-dirs` skill.
