# Rename "references" → "belongs to" in UI

## Decision

Quorum consensus (Gemini 3.1 Pro, GPT-5.4, Claude Opus) on 2026-03-23: **do not drop `references` as a relationship type**. Instead, rename the user-facing label from "references" to "belongs to" while keeping the internal cardinality value unchanged.

### Why not drop it

- `references` is the FK-ownership primitive — it drives schema splitting, ORM building, and topological sort
- Auto-inverse naming (`_infer_inverse_name`) derives names from the source object name, not the relationship name — dropping `references` would force users through weak auto-naming, losing custom FK names like `author_id` vs `reviewer_id`
- Multiple FKs to the same table would collide on inverse names

### Why rename the label

- "belongs to" is universally understood from Rails, Prisma, Django, Laravel
- Maps directly to "this model holds the FK"
- Reduces cognitive load without losing structural expressiveness

## Scope

**Frontend only.** Backend is unchanged — the API contract, database CHECK constraint, and code generation pipeline all continue to use the string `"references"` internally.

## Changes

| File | Change |
|------|--------|
| `frontend/src/lib/components/form/ObjectFormContent.svelte:168` | `label: 'references'` → `label: 'belongs to'` |
| `frontend/src/lib/components/form/ObjectFormContent.svelte:545` | Update comment: "FK Hint for references" → "FK Hint for belongs to" |
| `frontend/src/lib/domain/relationships.ts:10-14` | Update JSDoc: "non-references cardinality" → "non-belongs-to cardinality", "`references` relationships" → "`belongs to` relationships" |
