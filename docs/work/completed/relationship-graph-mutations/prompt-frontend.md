# Session Prompt: Relationship Graph Mutations — Frontend

## Context

You are creating a store reconciler that applies graph mutation results from relationship endpoints across all stores atomically. The full plan is at:

`/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/docs/work/relationship-graph-mutations/plan-frontend.md`

Read the plan before doing anything.

## Instructions

Execute all tasks without stopping. Run tests once per task, not between edits. Use `git add <file> && git commit -m "message"` directly. Do NOT create branches. NEVER use `rm -rf`.

## Scope

- **Tasks**: 7 tasks across 5 parts
- **Parts**: Types + API layer, Store reconciler, Wire into objectsModel, Tests, Verification
- **Estimated files**: 4 files to modify (`types/index.ts`, `api/objects.ts`, `objectsModel.svelte.ts`), 1 new file (`stores/reconciler.ts`), 1 test file

## Key Constraints

- Working directory: `/Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend/`
- Test: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend && bunx vitest run`
- Type check: `cd /Users/evgesha/Projects/dev-tools/mediancode/repos/mediancode-dev-orchestrator/frontend && bun run svelte-check --tsconfig ./tsconfig.json`
- SvelteKit 5, Svelte 5.41+, TypeScript
