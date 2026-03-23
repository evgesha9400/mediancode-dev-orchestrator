# Frontend Plan: Relationship Field Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

## Goal

Fix the endpoint editor's request/response preview to show FK ID fields for `references` relationships, matching what the backend actually generates.

## Architecture

The preview pipeline flows: `objectsStore` (holds `ObjectDefinition` with `fields` and `relationships`) → `examples.ts` (utility functions build preview JSON) → `ResponsePreview.svelte` (renders the JSON). Currently `examples.ts` only iterates over `objectDef.fields`, ignoring `objectDef.relationships`. The fix adds a second loop over relationships to inject FK ID entries for `references` cardinality.

## Tech Stack

SvelteKit 5, TypeScript, Svelte 5.41+, vitest.

## Prerequisite

Backend must be deployed with the matching API changes first. The backend plan is at:
`docs/work/relationship-field-fixes/plan-backend.md`

---

## Part 1: Add FK IDs to Preview Functions

### Task 1.1: Update `buildResponseBodyFromObjectId` in `examples.ts`

**Files:** `src/lib/utils/examples.ts`

**Steps:**

1. Open `src/lib/utils/examples.ts`. The function `buildResponseBodyFromObjectId` (~line 83) currently iterates only over `objectDef.fields`:

```typescript
export function buildResponseBodyFromObjectId(objectId: string | undefined, objects?: any[]): Record<string, any> {
    if (!objectId) return {};
    const objectDef = getObjectById(objectId);
    if (!objectDef) return {};

    const obj: Record<string, any> = {};
    objectDef.fields
        .filter(fieldRef => fieldRef.exposure !== 'write_only')
        .forEach(fieldRef => {
            const field = getFieldById(fieldRef.fieldId);
            if (field) obj[field.name] = getExampleValueForType(field.type);
        });
    return obj;
}
```

2. After the fields loop and before `return obj`, add a relationships loop that injects FK IDs for `references` relationships:

```typescript
    // Add FK ID fields for `references` relationships
    if (objectDef.relationships) {
        objectDef.relationships
            .filter(rel => rel.cardinality === 'references' && !rel.isInferred)
            .forEach(rel => {
                const fkName = rel.name + '_id';
                if (!(fkName in obj)) {
                    obj[fkName] = getExampleValueForType(getTargetPkType(rel.targetObjectId));
                }
            });
    }
```

3. Add a helper function `getTargetPkType` near the top of the file (after the imports, ~line 9):

```typescript
/**
 * Get the PK field type of a target object for FK type derivation.
 * Falls back to 'uuid' if the target or its PK field cannot be found.
 */
function getTargetPkType(targetObjectId: string): string {
    const targetObj = getObjectById(targetObjectId);
    if (!targetObj) return 'uuid';

    const pkRef = targetObj.fields.find(f => f.isPk);
    if (!pkRef) return 'uuid';

    const pkField = getFieldById(pkRef.fieldId);
    return pkField?.type ?? 'uuid';
}
```

**Test:** `cd frontend && bunx vitest run src/lib/utils/examples`

**Commit:** `fix(preview): show FK IDs for references relationships in response preview`

### Task 1.2: Update `buildRequestBodyFromObjectId` in `examples.ts`

**Files:** `src/lib/utils/examples.ts`

**Steps:**

1. The function `buildRequestBodyFromObjectId` (~line 64) needs the same FK injection. After the fields loop and before `return obj`, add:

```typescript
    // Add FK ID fields for `references` relationships (needed in create/update requests)
    if (objectDef.relationships) {
        objectDef.relationships
            .filter(rel => rel.cardinality === 'references' && !rel.isInferred)
            .forEach(rel => {
                const fkName = rel.name + '_id';
                if (!(fkName in obj)) {
                    obj[fkName] = getExampleValueForType(getTargetPkType(rel.targetObjectId));
                }
            });
    }
```

2. The `getTargetPkType` helper is already added from Task 1.1 — no duplicate needed.

**Test:** `cd frontend && bunx vitest run src/lib/utils/examples`

**Commit:** `fix(preview): show FK IDs for references relationships in request preview`

### Task 1.3: Update `buildObjectFromObjectId` in `examples.ts`

**Files:** `src/lib/utils/examples.ts`

**Steps:**

1. The function `buildObjectFromObjectId` (~line 38) is the base builder. Add the same FK injection after the fields loop:

```typescript
    // Add FK ID fields for `references` relationships
    if (objectDef.relationships) {
        objectDef.relationships
            .filter(rel => rel.cardinality === 'references' && !rel.isInferred)
            .forEach(rel => {
                const fkName = rel.name + '_id';
                if (!(fkName in obj)) {
                    obj[fkName] = getExampleValueForType(getTargetPkType(rel.targetObjectId));
                }
            });
    }
```

**Test:** `cd frontend && bunx vitest run src/lib/utils/examples`

**Commit:** `fix(preview): show FK IDs in base object builder`

---

## Part 2: Tests

### Task 2.1: Add/update tests for FK ID preview injection

**Files:** Check for existing test file at `src/lib/utils/examples.test.ts` or `src/lib/utils/__tests__/examples.test.ts`. If none exists, create `src/lib/utils/examples.test.ts`.

**Steps:**

1. The tests need to mock `getObjectById` and `getFieldById` store functions. Use vitest's `vi.mock`.

2. Add tests covering:
   - Response preview includes `author_id` for a `references` relationship
   - Request preview includes `author_id` for a `references` relationship
   - `has_many` relationships do NOT add fields to preview
   - `many_to_many` relationships do NOT add fields to preview
   - Inferred `references` relationships do NOT add FK fields (only user-defined ones)
   - FK type matches target PK type (e.g., if target PK is `int`, FK preview shows `0` not a UUID string)

3. Example test structure:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildResponseBodyFromObjectId, buildRequestBodyFromObjectId } from './examples';

// Mock the store functions
vi.mock('$lib/stores/objects', () => ({
    getObjectById: vi.fn(),
    objectsStore: { subscribe: vi.fn() }
}));
vi.mock('$lib/stores/fields', () => ({
    getFieldById: vi.fn()
}));

import { getObjectById } from '$lib/stores/objects';
import { getFieldById } from '$lib/stores/fields';

describe('FK ID preview injection', () => {
    beforeEach(() => {
        vi.mocked(getFieldById).mockImplementation((id: string) => {
            const fields: Record<string, any> = {
                'field-id': { id: 'field-id', name: 'id', type: 'uuid', constraints: [], validators: [], usedInApis: [], namespaceId: 'ns', container: null },
                'field-title': { id: 'field-title', name: 'title', type: 'str', constraints: [], validators: [], usedInApis: [], namespaceId: 'ns', container: null },
                'target-pk': { id: 'target-pk', name: 'id', type: 'uuid', constraints: [], validators: [], usedInApis: [], namespaceId: 'ns', container: null },
            };
            return fields[id];
        });
    });

    it('includes author_id in response for references relationship', () => {
        vi.mocked(getObjectById).mockImplementation((id: string) => {
            if (id === 'post-id') {
                return {
                    id: 'post-id', namespaceId: 'ns', name: 'Post',
                    fields: [
                        { fieldId: 'field-id', isPk: true, exposure: 'read_only' as const, nullable: false },
                        { fieldId: 'field-title', isPk: false, exposure: 'read_write' as const, nullable: false },
                    ],
                    relationships: [{
                        id: 'rel-1', sourceObjectId: 'post-id', targetObjectId: 'user-id',
                        name: 'author', cardinality: 'references' as const, isInferred: false,
                    }],
                    validators: [], usedInApis: [],
                };
            }
            if (id === 'user-id') {
                return {
                    id: 'user-id', namespaceId: 'ns', name: 'User',
                    fields: [{ fieldId: 'target-pk', isPk: true, exposure: 'read_only' as const, nullable: false }],
                    relationships: [], validators: [], usedInApis: [],
                };
            }
            return undefined;
        });

        const result = buildResponseBodyFromObjectId('post-id');
        expect(result).toHaveProperty('author_id');
    });

    it('does not include FK for has_many relationships', () => {
        vi.mocked(getObjectById).mockImplementation((id: string) => {
            if (id === 'user-id') {
                return {
                    id: 'user-id', namespaceId: 'ns', name: 'User',
                    fields: [{ fieldId: 'field-id', isPk: true, exposure: 'read_only' as const, nullable: false }],
                    relationships: [{
                        id: 'rel-2', sourceObjectId: 'user-id', targetObjectId: 'post-id',
                        name: 'posts', cardinality: 'has_many' as const, isInferred: false,
                    }],
                    validators: [], usedInApis: [],
                };
            }
            return undefined;
        });

        const result = buildResponseBodyFromObjectId('user-id');
        expect(result).not.toHaveProperty('posts_id');
        expect(result).not.toHaveProperty('posts');
    });
});
```

**Test:** `cd frontend && bunx vitest run src/lib/utils/examples`

**Commit:** `test(preview): add FK ID preview injection tests`

---

## Final Verification

### Task 3.1: Run full frontend test suite

**Steps:**

1. Type check: `cd frontend && bun run svelte-check --tsconfig ./tsconfig.json`
2. Unit tests: `cd frontend && bunx vitest run`
3. Fix any failures before completing.

**Commit:** (only if fixes needed)


---

## Expected API Contract

After these fixes, the endpoint editor preview for a `Post` object with `references` relationship to `User` shows:

**Request preview (POST/PUT/PATCH):**
```json
{
  "title": "string",
  "author_id": "00000000-0000-0000-0000-000000000000"
}
```

**Response preview (GET):**
```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "title": "string",
  "author_id": "00000000-0000-0000-0000-000000000000"
}
```

For `has_one`, `has_many`, `many_to_many` — no fields appear in previews.
