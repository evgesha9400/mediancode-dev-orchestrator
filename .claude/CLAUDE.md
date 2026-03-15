# Session Instructions

## No Worktrees — MANDATORY

NEVER use git worktrees for this project. Use simple feature branches instead.

## Commit Policy

ALWAYS use the `/commit` skill when creating git commits.

## MCP Server Development

When modifying the MCP server (`mission-control/`):
1. Write tests first (TDD)
2. Run `cd mission-control && npm test` after every change
3. The server must remain domain-agnostic — no Median-specific code
