# Plan: Rename "references" → "belongs to" (Frontend)

**Spec:** [spec.md](spec.md)
**Backend plan:** None — no backend changes needed.

## Task 1: Rename dropdown label

**File:** `src/lib/components/form/ObjectFormContent.svelte`

1. Line 168: Change `{ value: 'references', label: 'references' }` → `{ value: 'references', label: 'belongs to' }`
2. Line ~545: Update comment from "FK Hint for references" → "FK Hint for belongs to"

**Internal value stays `'references'`** — only the display label changes.

## Task 2: Update JSDoc comments

**File:** `src/lib/domain/relationships.ts`

Update the JSDoc on `getFkHint` (lines 10-14) to say "belongs to" instead of "references" in the user-facing description. Keep `references` where it refers to the internal cardinality value.

## Task 3: Verify

1. `cd frontend && bun run svelte-check --tsconfig ./tsconfig.json` — type check
2. `cd frontend && bunx vitest run` — unit tests (no test changes expected — tests use internal enum values, not labels)
3. Manual check: open the object form, confirm dropdown shows "belongs to"

## Risk

None. This is a display-only label change. No API contracts, no backend logic, no test data affected.
