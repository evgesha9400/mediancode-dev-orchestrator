# Session Instructions

## Subagent Skill Scoping — MANDATORY

Subagents MUST only use skills matching their scope:
- Frontend subagents: only `fe--*` skills
- Backend subagents: only `be--*` skills
- Unscoped skills (no prefix) are for orchestrator use only

## Test Policy

Always ensure all tests pass, even if failures are pre-existing. If it is unclear whether to fix the application code or update the tests, provide a report of the errors found and ask the user before making changes.

## Commit Policy — MANDATORY

**ALWAYS use the `/commit` skill when creating git commits.** Never write raw `git commit` commands. This applies in ALL contexts: main repo, plan execution, subagent work — no exceptions.

## Frontend: No Worktrees — MANDATORY

**NEVER use git worktrees for the frontend repo.** Bun's hardlinked `node_modules` makes worktree cleanup hang indefinitely on macOS. Use simple feature branches instead.
