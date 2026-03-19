# Session Prompt: Validation Consistency — Backend

## Context

You are fixing validation divergences between the API/backend and frontend layers. The full implementation plan is at:

`/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/docs/work/validation-consistency/plan-backend.md`

The design spec is at:

`/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/docs/work/validation-consistency/spec.md`

Read both before doing anything.

## Instructions

Execute the plan task-by-task following these rules:

1. Read the full plan first
2. Execute task-by-task in order — do NOT skip ahead
3. Run tests after each task — fix failures before moving on
4. Commit after each task with the commit message specified in the plan
5. Zero failures is the only acceptable outcome
6. If a test fails, fix it before proceeding — do not accumulate debt

**REQUIRED SUB-SKILL:** Use superpowers:executing-plans to implement this plan.

## Scope

- **Tasks**: 10 tasks across 5 parts
- **Parts**: Fix server_default data loss, Fix PascalCase divergence, Normalize PK types, Derive CHECK constraints, Centralize validation constants
- **Estimated files**: 6 files to create/modify

## Key Constraints

- Working directory: `backend/`
- Test commands: `make test` (unit) and `make test-e2e` (integration, requires PostgreSQL)
- Format: `poetry run black src/ tests/`
- All commits use the `/commit` skill
- Do NOT modify frontend code
