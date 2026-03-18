# Idea: Per-Method Field Visibility (Create/Update/Response Booleans)

**Source:** Codex GPT-5.4 consultation (2026-03-18)
**Status:** Parked — evaluate when demand is clear

## Problem

The current `appears` flag (`both | request | response`) controls whether a field appears in request schemas (Create + Update) or response schemas. But it cannot distinguish between Create and Update.

Real example: a `password` field on a `User` object should be:
- In Create (required when creating a user)
- NOT in Update (password changes go through a separate flow)
- NOT in Response (never returned)

With the current `appears: 'request'`, password ends up in both Create AND Update. There is no way to express "Create only."

## Proposed Solution

Replace the single `appears` enum with three explicit booleans on the object-field association:

| Boolean | Meaning | Maps to schema |
|---------|---------|---------------|
| `create` | Field appears in Create schema | `{Object}Create` |
| `update` | Field appears in Update schema | `{Object}Update` |
| `response` | Field appears in Response schema | `{Object}Response` |

Backward-compatible aliases for the old `appears` values:
- `both` → `create=true, update=true, response=true`
- `request` → `create=true, update=true, response=false`
- `response` → `create=false, update=false, response=true`

The password case becomes: `create=true, update=false, response=false`.

## Philosophy Check

- **Structural?** Yes — it's metadata about schema shape
- **Deterministic?** Yes — same booleans → same schemas
- **>80% of projects?** Unclear. The password case is common for User objects, but most objects (Product, Order) don't need Create/Update distinction
- **LLM faster?** Removing a field from an Update schema is a 3-second LLM task post-generation

## Decision

Parked. The current `both | request | response` covers the majority of cases. The Create/Update distinction is a real need but may not clear the >80% bar. Revisit if users frequently request this.

## Impact if Implemented

- `ObjectFieldAssociation` in the DB: replace `appears` column with three boolean columns
- `schema_splitter.py`: filter by individual booleans instead of enum
- Frontend field editor: three checkboxes instead of a dropdown
- Migration: expand existing `appears` values to boolean triples
