# Validation Consistency — Spec

## Problem

Validation rules across the three layers (frontend, API, database) have drifted apart. Rules present in one layer are missing or different in another, creating inconsistency for direct API users and data integrity risks for developers.

## Divergences Found

An audit across all three models (Claude, Gemini, GPT-5.4) identified these concrete divergences:

### Bugs (Data Loss / Incorrect Behavior)

| # | Severity | Divergence | Where |
|---|----------|-----------|-------|
| 1 | **High** | `server_default` and `default_literal` are accepted in the API schema (`ObjectFieldReferenceSchema`) but **never persisted** by `ObjectService._set_field_associations()`. Data is silently dropped. | `src/api/services/object.py:188-196` vs `src/api/schemas/object.py:30-31` |
| 2 | **Medium** | PascalCase validation differs: backend allows underscores (`User_Name` passes), frontend rejects them. Edge cases like `A1B` pass backend but fail frontend regex. | `src/api_craft/models/validators.py:583` vs `src/lib/utils/validation.ts:18` |
| 3 | **Low** | `ALLOWED_PK_TYPES` includes `"UUID"` (uppercase) in backend but not in frontend. Seed data uses lowercase `"uuid"`, so this only affects direct API users. | `src/api_craft/models/validators.py:230` vs `ObjectFormContent.svelte:37` |

### Systematic Drift Risks

| # | Risk | Description |
|---|------|------------|
| 4 | CHECK constraints hardcoded in migration | `check_constraint_sql()` helper exists in `enums.py` but the migration hardcodes values. Adding a new enum value to a Literal type won't auto-propagate to DB constraints. |
| 5 | Frontend enforces constraint/template compatibility; backend doesn't | Frontend filters constraints by `compatibleTypes` and validates required params. Backend services just store references without validation. |
| 6 | Validation constants scattered | Name regexes, PK types, server-default compat maps, operator compat maps are independently defined in `validators.py`, `ObjectFormContent.svelte`, `types/index.ts`, etc. |

### By Design (Not Bugs)

| # | Observation | Verdict |
|---|------------|---------|
| 7 | Generated Pydantic enforces more than generated DB (`min_length`, `pattern`, `gt` etc. don't become CHECK constraints) | **Correct per philosophy.** Only `max_length` has a natural SQL mapping. Adding CHECK constraints for behavioral validations is past the median. |
| 8 | Endpoint param rules duplicated in `paramInference.ts` and `validators.py` | **Acceptable.** Frontend provides immediate feedback; backend is the authoritative enforcer. Different languages require separate implementations. CI can catch drift. |

## Design Decisions

### Source of Truth

Extend the existing `api_craft/models/enums.py` pattern. This module is already the canonical source for Literal types, re-exported through `api/schemas/literals.py`. Add a sibling `validation_catalog.py` that consolidates:
- Name validation regexes (snake_case, PascalCase patterns)
- `ALLOWED_PK_TYPES`
- `SERVER_DEFAULT_VALID_TYPES`
- `OPERATOR_VALID_TYPES`

Backend services and `validators.py` import from the catalog. The frontend continues using its own implementations but a CI contract test verifies equivalence.

### Enforcement Points

Three-point enforcement (all three models converged on this):
1. **Backend write-time** — services reject invalid specs immediately on create/update
2. **Code generation time** — `validators.py` catches cross-entity semantic errors
3. **CI time** — contract tests catch drift between frontend and backend constants

### Layer-Specific Validations

Not every validation belongs in every layer:
- **UI-only**: Progressive disclosure, touched-state errors, live hints — frontend only
- **API-only**: Ownership checks, namespace access, auth — backend only
- **DB-only**: FK constraints, UNIQUE, partial indexes — database only
- **Shared**: Name format, enum values, type compatibility — must be consistent across FE/BE

### What NOT To Do

Per philosophy ("don't over-engineer", "generate structure, leave behavior"):
- Do NOT build a shared JSON schema runtime dependency
- Do NOT generate the entire frontend validation module from backend
- Do NOT add CHECK constraints for every Pydantic `Field()` parameter
- Do NOT create a YAML config file (the existing `global_config.yaml` is already stale/reference-only — keeping truth in importable Python code is better)

## Implementation Scope

### Phase 1: Backend Plan (this initiative)

Fix all bugs and systematic drift risks. Create the validation catalog module. Add consistency tests.

**All changes are backend-only.** The frontend was already correct on PascalCase and PK types — the backend aligns to it.

### Phase 2: Frontend Alignment (future initiative)

After Phase 1 is deployed:
- Replace hardcoded frontend constants with API-served catalog data (if warranted)
- Add `// MIRROR: backend validators.py` comments for cross-layer traceability
- Add CI contract test that runs identical inputs through FE/BE name validators

Phase 2 will be planned separately after Phase 1 is complete.
