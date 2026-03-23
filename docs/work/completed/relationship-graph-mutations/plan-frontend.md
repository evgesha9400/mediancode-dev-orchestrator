# Frontend Plan: Relationship Graph Mutations

> **For Claude:** REQUIRED SUB-SKILL: Use autonomous-executing-plans

## Goal

Create a store reconciler that applies graph mutation results from relationship endpoints across `objectsStore` and `fieldsStore` atomically, replacing the current siloed store updates.

## Architecture

The backend relationship endpoints now return `RelationshipMutationResponse` with `updatedObjects`, `createdFields`, and `deletedFieldIds`. The frontend needs:

1. A `GraphMutationResult` TypeScript type matching the backend response
2. A `reconciler.ts` module with `applyGraphMutation()` that patches both stores
3. Updated API functions to return `GraphMutationResult`
4. Updated `objectsModel.svelte.ts` to use the reconciler instead of manual store patching

## Tech Stack

SvelteKit 5, Svelte 5.41+, TypeScript, vitest.

## Prerequisite

Backend must be deployed with graph mutation responses. The backend plan is at:
`docs/work/relationship-graph-mutations/plan-backend.md`

---

## Part 1: Types and API Layer

### Task 1.1: Add GraphMutationResult type

**Files:** `src/lib/types/index.ts`

**Steps:**

1. Add the type near the other API-related types:

```typescript
/** Result of a graph mutation (relationship create/delete) with all side effects */
export interface GraphMutationResult {
  updatedObjects: ObjectDefinition[];
  createdFields: Field[];
  deletedFieldIds: string[];
}
```

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(types): add GraphMutationResult type`

### Task 1.2: Update API functions to return GraphMutationResult

**Files:** `src/lib/api/objects.ts`

**Steps:**

1. Update `createRelationshipApi` (~line 202) to return `GraphMutationResult`:

```typescript
export async function createRelationshipApi(
	objectId: string,
	data: { targetObjectId: string; name: string; cardinality: string }
): Promise<GraphMutationResult> {
	const response = await apiPost<any>(`/objects/${objectId}/relationships`, data);
	return {
		updatedObjects: (response.updatedObjects ?? []).map(transformObject),
		createdFields: (response.createdFields ?? []).map(transformField),
		deletedFieldIds: response.deletedFieldIds ?? [],
	};
}
```

2. Update `deleteRelationshipApi` (~line 213) to return `GraphMutationResult` instead of `void`:

```typescript
export async function deleteRelationshipApi(
	objectId: string,
	relationshipId: string
): Promise<GraphMutationResult> {
	const response = await apiDelete<any>(`/objects/${objectId}/relationships/${relationshipId}`);
	return {
		updatedObjects: (response.updatedObjects ?? []).map(transformObject),
		createdFields: (response.createdFields ?? []).map(transformField),
		deletedFieldIds: response.deletedFieldIds ?? [],
	};
}
```

3. Import `transformField` from `$lib/api/fields` (or add it inline if not exported). Also import `GraphMutationResult` from types.

Note: Check what `apiDelete` currently returns — if it doesn't return a body, you may need to use `apiDeleteWithResponse` or adjust the HTTP client to parse the response body for DELETE requests that return 200 instead of 204.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(api): return GraphMutationResult from relationship endpoints`

---

## Part 2: Store Reconciler

### Task 2.1: Create reconciler.ts

**Files:** `src/lib/stores/reconciler.ts` (new file)

**Steps:**

1. Create a new module that applies graph mutation results across stores:

```typescript
import type { GraphMutationResult } from '$lib/types';
import { objectsStore } from './objects';
import { fieldsStore } from './fields';

/**
 * Apply a graph mutation result across all affected stores.
 *
 * Relationship create/delete operations touch multiple entities (objects, fields).
 * This function reconciles all stores atomically instead of each model
 * patching its own store in isolation.
 */
export function applyGraphMutation(result: GraphMutationResult): void {
	// 1. Upsert updated objects
	if (result.updatedObjects.length > 0) {
		objectsStore.update(objects => {
			const updatedMap = new Map(result.updatedObjects.map(o => [o.id, o]));
			return objects.map(o => updatedMap.get(o.id) ?? o);
		});
	}

	// 2. Remove deleted fields, then upsert new/updated fields
	if (result.deletedFieldIds.length > 0 || result.createdFields.length > 0) {
		fieldsStore.update(fields => {
			let next = fields;

			// Remove deleted
			if (result.deletedFieldIds.length > 0) {
				const deletedSet = new Set(result.deletedFieldIds);
				next = next.filter(f => !deletedSet.has(f.id));
			}

			// Upsert created/updated
			if (result.createdFields.length > 0) {
				const existingIds = new Set(next.map(f => f.id));
				const newFields = result.createdFields.filter(f => !existingIds.has(f.id));
				next = [...next, ...newFields];
			}

			return next;
		});
	}
}
```

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(stores): add reconciler for cross-store graph mutation updates`

---

## Part 3: Wire Into objectsModel

### Task 3.1: Use reconciler in handleUpdate

**Files:** `src/lib/stores/objectsModel.svelte.ts`

**Steps:**

1. Import the reconciler:

```typescript
import { applyGraphMutation } from './reconciler';
```

2. In `handleUpdate` (~line 340), replace the relationship persistence loop that manually patches `objectsStore` with reconciler calls:

**Before** (approximate):
```typescript
      for (const rel of removedRels) {
        await deleteRelationshipApi(latestObject.id, rel.id);
      }
      for (const rel of addedRels) {
        latestObject = await createRelationshipApi(latestObject.id, {
          targetObjectId: rel.targetObjectId,
          name: rel.name,
          cardinality: rel.cardinality
        });
      }
      if (addedRels.length > 0 || removedRels.length > 0) {
        objectsStore.update(objects => objects.map(o => o.id === latestObject.id ? latestObject : o));
      }
```

**After:**
```typescript
      for (const rel of removedRels) {
        const result = await deleteRelationshipApi(latestObject.id, rel.id);
        applyGraphMutation(result);
      }
      for (const rel of addedRels) {
        const result = await createRelationshipApi(latestObject.id, {
          targetObjectId: rel.targetObjectId,
          name: rel.name,
          cardinality: rel.cardinality
        });
        applyGraphMutation(result);
        // Update latestObject from the reconciled store
        const updated = result.updatedObjects.find(o => o.id === latestObject.id);
        if (updated) latestObject = updated;
      }
```

3. Remove the manual `objectsStore.update(...)` call that was inside the relationship loop — the reconciler handles it.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `refactor(objects): use reconciler for relationship mutations in handleUpdate`

### Task 3.2: Use reconciler in handleCreate

**Files:** `src/lib/stores/objectsModel.svelte.ts`

**Steps:**

1. In `handleCreate` (~line 396), replace the relationship persistence loop similarly:

**Before:**
```typescript
          for (const rel of userRelationships) {
            const created = await createRelationshipApi(object.id, {...});
            objectsStore.update(objects => objects.map(o => o.id === created.id ? created : o));
          }
```

**After:**
```typescript
          for (const rel of userRelationships) {
            const result = await createRelationshipApi(object.id, {
              targetObjectId: rel.targetObjectId,
              name: rel.name,
              cardinality: rel.cardinality
            });
            applyGraphMutation(result);
          }
```

**Test:** `cd frontend && bunx vitest run`

**Commit:** `refactor(objects): use reconciler for relationship mutations in handleCreate`

---

## Part 4: Tests

### Task 4.1: Add reconciler unit tests

**Files:** `tests/unit/lib/stores/reconciler.test.ts` (new)

**Steps:**

1. Test `applyGraphMutation`:
   - Upserts updated objects into objectsStore
   - Adds new fields to fieldsStore
   - Removes deleted fields from fieldsStore
   - Handles empty mutation result (no-op)
   - Does not duplicate fields that already exist
   - Does not affect objects not in the mutation result

**Test:** `cd frontend && bunx vitest run`

**Commit:** `test(stores): add reconciler unit tests`

---

## Part 5: Final Verification

### Task 5.1: Run full test suite

**Steps:**

1. Type check: `cd frontend && bun run svelte-check --tsconfig ./tsconfig.json`
2. Unit tests: `cd frontend && bunx vitest run`
3. Fix any failures.

**Commit:** (only if needed)

---

## Expected API Contract

Same as backend plan — see `docs/work/relationship-graph-mutations/plan-backend.md`.

### POST /objects/{id}/relationships → `GraphMutationResult`
```json
{
  "updatedObjects": [/* source + target ObjectDefinitions */],
  "createdFields": [/* FK Field entities */],
  "deletedFieldIds": []
}
```

### DELETE /objects/{id}/relationships/{rel_id} → `GraphMutationResult`
```json
{
  "updatedObjects": [/* source + target ObjectDefinitions */],
  "createdFields": [],
  "deletedFieldIds": ["fk-field-uuid"]
}
```
