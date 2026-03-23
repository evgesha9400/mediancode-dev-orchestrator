# Session Prompt: Relationship Graph Mutations — Backend

## Context

You are changing relationship endpoints to return composite graph mutation responses that include all side effects (updated objects, created/deleted fields). The full plan is at:

`/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/docs/work/relationship-graph-mutations/plan-backend.md`

Read the plan before doing anything.

## Instructions

Execute all tasks without stopping. Run tests once per task, not between edits. Use `git add <file> && git commit -m "message"` directly. Do NOT create branches.

## Scope

- **Tasks**: 6 tasks across 5 parts
- **Parts**: Response schema, Router endpoints, Service helpers, Tests, Verification
- **Estimated files**: 3-4 files to modify (`relationship.py` schemas, `objects.py` router, service files), 1 test file

## Key Constraints

- Working directory: `/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend/`
- Test: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && make test`
- E2E: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && make test-e2e`
- Format: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/backend && poetry run black src/ tests/`
- Python 3.13+, SQLAlchemy 2.x async, Pydantic v2
