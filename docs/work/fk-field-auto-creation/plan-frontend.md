# Frontend Plan: FK Field Auto-Creation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

## Goal

Update the frontend to display auto-created FK fields with the new `fk` role — locked name/type, user-controllable nullable toggle, and proper integration with the object form and field picker.

## Architecture

The backend now auto-creates FK fields with `role: 'fk'` when `references` relationships are created. The frontend needs to:
1. Add `fk` to the `FieldRole` type system with labels, tooltips, and type constraints
2. Add `fkFieldId` to `ObjectRelationship` type and transform
3. Render FK fields as locked rows in the object form (name/type/role not editable, only nullable toggle)
4. Exclude `fk` from the role dropdown (auto-assigned only)
5. Hide/badge FK fields in the `FieldSelectorDropdown` so they aren't reused as free-form fields

## Tech Stack

SvelteKit 5, Svelte 5.41+, TypeScript, vitest.

## Prerequisite

Backend must be deployed with the matching API changes first. The backend plan is at:
`docs/work/fk-field-auto-creation/plan-backend.md`

---

## Part 1: Type System Updates

### Task 1.1: Add `fk` to FieldRole type and constants

**Files:** `src/lib/types/index.ts`

**Steps:**

1. Add `'fk'` to the `FieldRole` union (~line 191):

**Before:**
```typescript
export type FieldRole =
  | 'pk'
  | 'writable'
  | 'write_only'
  | 'read_only'
  | 'created_timestamp'
  | 'updated_timestamp'
  | 'generated_uuid';
```

**After:**
```typescript
export type FieldRole =
  | 'pk'
  | 'fk'
  | 'writable'
  | 'write_only'
  | 'read_only'
  | 'created_timestamp'
  | 'updated_timestamp'
  | 'generated_uuid';
```

2. Add `'fk'` to `FIELD_ROLES` array (~line 200):

```typescript
export const FIELD_ROLES: FieldRole[] = [
  'pk', 'fk', 'writable', 'write_only', 'read_only',
  'created_timestamp', 'updated_timestamp', 'generated_uuid'
];
```

3. Add `fk` to `ROLE_LABELS` (~line 205):

```typescript
  fk: 'Foreign Key',
```

4. Add `fk` to `ROLE_TOOLTIPS` (~line 215):

```typescript
  fk: 'Auto-managed reference to another object. Name and type are locked.',
```

5. Add `fk` to `ROLE_TYPE_CONSTRAINTS` (~line 225) — FK fields can be int or uuid (matches PK constraints):

```typescript
  fk: ['int', 'uuid', 'uuid.UUID'],
```

6. Update `getAvailableRoles()` (~line 233) to exclude `fk` from the dropdown — it's auto-assigned only:

**Before:**
```typescript
export function getAvailableRoles(fieldType: string): FieldRole[] {
  return FIELD_ROLES.filter(role => {
    const constraint = ROLE_TYPE_CONSTRAINTS[role];
    if (!constraint) return true;
    return constraint.includes(fieldType);
  });
}
```

**After:**
```typescript
export function getAvailableRoles(fieldType: string): FieldRole[] {
  return FIELD_ROLES.filter(role => {
    if (role === 'fk') return false;  // auto-assigned only, not user-selectable
    const constraint = ROLE_TYPE_CONSTRAINTS[role];
    if (!constraint) return true;
    return constraint.includes(fieldType);
  });
}
```

7. Update `roleHasModifiers()` (~line 242) — FK fields support nullable toggle but NOT default values:

**Before:**
```typescript
export function roleHasModifiers(role: FieldRole): boolean {
  return role === 'writable' || role === 'write_only' || role === 'read_only';
}
```

**After:**
```typescript
export function roleHasModifiers(role: FieldRole): boolean {
  return role === 'writable' || role === 'write_only' || role === 'read_only' || role === 'fk';
}
```

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(types): add fk to FieldRole with labels, tooltips, and constraints`

### Task 1.2: Add `fkFieldId` to ObjectRelationship type

**Files:** `src/lib/types/index.ts`, `src/lib/api/objects.ts`

**Steps:**

1. In `ObjectRelationship` (~line 255), add `fkFieldId`:

**Before:**
```typescript
export interface ObjectRelationship {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  name: string;
  cardinality: Cardinality;
  isInferred: boolean;
  inverseId?: string;
}
```

**After:**
```typescript
export interface ObjectRelationship {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  name: string;
  cardinality: Cardinality;
  isInferred: boolean;
  inverseId?: string;
  fkFieldId?: string;
}
```

2. In `src/lib/api/objects.ts`, update `transformRelationship()` (~line 73) to include `fkFieldId`:

**Before:**
```typescript
function transformRelationship(response: ObjectRelationshipResponse): ObjectRelationship {
	return {
		id: response.id,
		sourceObjectId: response.sourceObjectId,
		targetObjectId: response.targetObjectId,
		name: response.name,
		cardinality: response.cardinality as Cardinality,
		isInferred: response.isInferred,
		inverseId: response.inverseId ?? undefined
	};
}
```

**After:**
```typescript
function transformRelationship(response: ObjectRelationshipResponse): ObjectRelationship {
	return {
		id: response.id,
		sourceObjectId: response.sourceObjectId,
		targetObjectId: response.targetObjectId,
		name: response.name,
		cardinality: response.cardinality as Cardinality,
		isInferred: response.isInferred,
		inverseId: response.inverseId ?? undefined,
		fkFieldId: response.fkFieldId ?? undefined
	};
}
```

3. In `src/lib/api/objects.ts`, update the `ObjectRelationshipResponse` type (or wherever the API response type is defined) to include `fkFieldId: string | null`.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(types): add fkFieldId to ObjectRelationship type and transform`

---

## Part 2: UI — Locked FK Field Rows

### Task 2.1: Render FK fields as locked rows in ObjectFormContent

**Files:** `src/lib/components/form/ObjectFormContent.svelte`

**Steps:**

1. In the fields rendering section, identify where each field row is rendered. For fields with `role === 'fk'`, render them as locked (non-editable) rows:

- Name input: `disabled`, show a key/link icon badge
- Type display: static text (not a dropdown)
- Role dropdown: static "FK" badge (not a dropdown)
- Nullable toggle: **enabled** (this is the only editable property)
- Default value input: **hidden** (FK fields have no defaults)
- Delete button: **hidden** (FK lifecycle is managed by the relationship)

2. Add visual distinction — e.g., a subtle border color or badge — so users understand this field is auto-managed.

3. The existing FK hint (`getFkHint` rendering) should now show green ✓ for objects with auto-created FK fields. Verify this works correctly since the real FK field now exists in the fields list.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(objects): render FK fields as locked rows in object form`

### Task 2.2: Hide FK fields from FieldSelectorDropdown

**Files:** `src/lib/components/form/FieldSelectorDropdown.svelte` (or wherever the field picker component lives)

**Steps:**

1. When listing available fields for attaching to objects, filter out fields that have `role === 'fk'` in any existing object association. FK fields are managed by relationships and should not be manually attached to other objects.

2. Alternatively, show FK fields with a "managed" badge and prevent selection.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(fields): hide managed FK fields from field selector dropdown`

---

## Part 3: Preview Cleanup

### Task 3.1: Remove FK preview injection from examples.ts (Phase 2 prep)

**Files:** `src/lib/utils/examples.ts`

**Steps:**

1. Since FK fields now exist as real fields with `role === 'fk'`, the standard field iteration in `buildResponseBodyFromObjectId` and `buildRequestBodyFromObjectId` will pick them up automatically.

2. However, `fk` fields are not excluded by the current role filters:
   - Request preview: filters for `role === 'writable' || role === 'write_only'` — this **excludes** `fk`. Update to include `fk`:

```typescript
.filter(fieldRef => fieldRef.role === 'writable' || fieldRef.role === 'write_only' || fieldRef.role === 'fk')
```

   - Response preview: filters for `role !== 'write_only'` — this **includes** `fk` already. No change needed.

3. The relationship-based FK injection blocks can stay for now (Phase 1 coexistence — the dedup guards prevent double entries). Mark them with a `// TODO: Remove in Phase 2 when all data is migrated` comment.

4. Remove the `getTargetPkType` helper only in Phase 2.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `feat(preview): include fk role in request preview filter`

---

## Part 4: Tests

### Task 4.1: Update/add tests

**Files:** Tests for types, preview, and object form.

**Steps:**

1. **Type tests**: Verify `getAvailableRoles()` never returns `fk`. Verify `roleHasModifiers('fk')` returns `true`.

2. **Preview tests**: Verify that a field with `role: 'fk'` appears in both request and response previews.

3. **Transform tests**: Verify `transformRelationship()` maps `fkFieldId` correctly.

**Test:** `cd frontend && bunx vitest run`

**Commit:** `test(types): add fk role and FK field preview tests`

---

## Part 5: Final Verification

### Task 5.1: Run full frontend test suite

**Steps:**

1. Type check: `cd frontend && bun run svelte-check --tsconfig ./tsconfig.json`
2. Unit tests: `cd frontend && bunx vitest run`
3. Fix any failures before completing.

**Commit:** (only if fixes needed)

---

## Expected API Contract

After implementation, the object's field list includes FK fields with `role: 'fk'`:

**GET /objects/{id}** response:
```json
{
  "id": "product-uuid",
  "name": "Product",
  "fields": [
    {"fieldId": "pk-field-uuid", "role": "pk", "optional": false},
    {"fieldId": "name-field-uuid", "role": "writable", "optional": false},
    {"fieldId": "fk-field-uuid", "role": "fk", "optional": false}
  ],
  "relationships": [
    {
      "id": "rel-uuid",
      "sourceObjectId": "product-uuid",
      "targetObjectId": "customer-uuid",
      "name": "customer",
      "cardinality": "references",
      "isInferred": false,
      "inverseId": "inverse-rel-uuid",
      "fkFieldId": "fk-field-uuid"
    }
  ]
}
```

The FK field entity:
```json
{
  "id": "fk-field-uuid",
  "name": "customer_id",
  "type": "<matches target PK type>",
  "description": "FK reference to Customer"
}
```
