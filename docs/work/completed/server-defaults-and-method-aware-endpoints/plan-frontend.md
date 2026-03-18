# Server Defaults — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. You are working on the frontend. Working directory: `frontend/`. Only use `fe--*` skills. Do not modify backend code.

**Goal:** Add server default UI controls to the Object editor so users can configure server default strategies for response-only fields. Ensure every valid configuration produces working, deployable code.

**Architecture:** Add `ServerDefault` type and extend `ObjectFieldReference` with `serverDefault` + `defaultLiteral`. Update the API layer to pass these fields. Add conditional UI controls to `ObjectFormContent` that appear when a field is response-only and non-PK. Add frontend validation.

**Tech Stack:** SvelteKit 5, Svelte 5.41+, TypeScript, Tailwind CSS, Font Awesome

**Spec:** `docs/work/server-defaults-and-method-aware-endpoints/spec.md`

**Prerequisite:** Backend plan must be completed first — the backend API must accept and return `serverDefault` and `defaultLiteral` on object field references.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/types/index.ts:190-197` | Add `ServerDefault` type; add `serverDefault`, `defaultLiteral` to `ObjectFieldReference` |
| Modify | `src/lib/api/objects.ts:14-19,61-68` | Add fields to `ObjectFieldReferenceResponse`, update `transformFieldReference` |
| Modify | `src/lib/components/form/ObjectFormContent.svelte:381-401` | Add server default dropdown + literal input after the Appears-in segmented control |
| Modify | `src/lib/stores/objectsModel.svelte.ts:174-182` | Add server default validation to `validate()` |

---

## Reference: Server Default Options by Field Type

The dropdown options are filtered by the field's type. The frontend needs to map `Field.type` (from the field library) to the valid options:

| Field Type | Valid Server Defaults |
|-----------|---------------------|
| `uuid`, `uuid.UUID` | `uuid4` |
| `datetime`, `datetime.datetime` | `now`, `now_on_update` |
| `date`, `datetime.date` | `now`, `now_on_update` |
| `int` | `auto_increment`, `literal` |
| `str`, `EmailStr`, `HttpUrl` | `literal` |
| `float`, `decimal`, `decimal.Decimal` | `literal` |
| `bool` | `literal` |

## Reference: When to Show Server Default Controls

Show the server default dropdown when ALL of:
- `appears === 'response'`
- `isPk === false`
- (Note: `optional` is always `false` when `appears === 'response'` — the UI enforces this automatically)

---

## Tasks

### Task 1: Add Types

**Files:**
- Modify: `frontend/src/lib/types/index.ts`

- [ ] **Step 1: Add ServerDefault type**

In `frontend/src/lib/types/index.ts`, add after `FieldAppearance` (line 190):

```typescript
export type ServerDefault = 'uuid4' | 'now' | 'now_on_update' | 'auto_increment' | 'literal';
```

- [ ] **Step 2: Add fields to ObjectFieldReference**

Update `ObjectFieldReference` (lines 192-197) to include the new fields:

```typescript
export interface ObjectFieldReference {
  fieldId: string;
  optional: boolean;
  isPk: boolean;
  appears: FieldAppearance;
  serverDefault?: ServerDefault;
  defaultLiteral?: string;
}
```

- [ ] **Step 3: Run type check**

```bash
cd frontend && bun run svelte-check --tsconfig ./tsconfig.json
```

Expected: PASS — the new fields are optional, so no existing code breaks.

- [ ] **Step 4: Commit**

```
feat(types): add ServerDefault type and fields to ObjectFieldReference
```

---

### Task 2: Update API Layer

**Files:**
- Modify: `frontend/src/lib/api/objects.ts`

- [ ] **Step 1: Update ObjectFieldReferenceResponse**

In `frontend/src/lib/api/objects.ts`, update `ObjectFieldReferenceResponse` (lines 14-19):

```typescript
interface ObjectFieldReferenceResponse {
	fieldId: string;
	optional: boolean;
	isPk: boolean;
	appears: string;
	serverDefault: string | null;
	defaultLiteral: string | null;
}
```

- [ ] **Step 2: Update transformFieldReference**

Update `transformFieldReference` (lines 61-68) to pass through the new fields:

```typescript
function transformFieldReference(response: ObjectFieldReferenceResponse): ObjectFieldReference {
	return {
		fieldId: response.fieldId,
		optional: response.optional,
		isPk: response.isPk ?? false,
		appears: (response.appears as FieldAppearance) ?? 'both',
		serverDefault: (response.serverDefault as ServerDefault) ?? undefined,
		defaultLiteral: response.defaultLiteral ?? undefined
	};
}
```

Add the `ServerDefault` import at the top:

```typescript
import type { ObjectDefinition, ObjectFieldReference, ObjectRelationship, InlineModelValidator, ServerDefault } from '$lib/types';
```

Note: `CreateObjectRequest` and `UpdateObjectRequest` use `ObjectFieldReference[]` for their `fields` property (lines 143, 153), so the new fields are automatically included in requests when present on the object.

- [ ] **Step 3: Run type check**

```bash
cd frontend && bun run svelte-check --tsconfig ./tsconfig.json
```

Expected: PASS

- [ ] **Step 4: Commit**

```
feat(api): pass serverDefault through object field reference API layer
```

---

### Task 3: Server Default UI in ObjectFormContent

**Files:**
- Modify: `frontend/src/lib/components/form/ObjectFormContent.svelte`

- [ ] **Step 1: Add server default helper functions**

In `ObjectFormContent.svelte`, add helper functions in the `<script lang="ts">` block. Add after the `setFieldAppears` function (line 145):

```typescript
  // --- Server default helpers ---
  const SERVER_DEFAULT_OPTIONS: Record<string, { value: ServerDefault; label: string }[]> = {
    uuid: [{ value: 'uuid4', label: 'UUID v4' }],
    'uuid.UUID': [{ value: 'uuid4', label: 'UUID v4' }],
    datetime: [
      { value: 'now', label: 'Now' },
      { value: 'now_on_update', label: 'Now (+ on update)' }
    ],
    'datetime.datetime': [
      { value: 'now', label: 'Now' },
      { value: 'now_on_update', label: 'Now (+ on update)' }
    ],
    date: [
      { value: 'now', label: 'Now' },
      { value: 'now_on_update', label: 'Now (+ on update)' }
    ],
    'datetime.date': [
      { value: 'now', label: 'Now' },
      { value: 'now_on_update', label: 'Now (+ on update)' }
    ],
    int: [
      { value: 'auto_increment', label: 'Auto increment' },
      { value: 'literal', label: 'Literal value' }
    ],
    str: [{ value: 'literal', label: 'Literal value' }],
    EmailStr: [{ value: 'literal', label: 'Literal value' }],
    HttpUrl: [{ value: 'literal', label: 'Literal value' }],
    float: [{ value: 'literal', label: 'Literal value' }],
    decimal: [{ value: 'literal', label: 'Literal value' }],
    'decimal.Decimal': [{ value: 'literal', label: 'Literal value' }],
    bool: [{ value: 'literal', label: 'Literal value' }],
  };

  function getServerDefaultOptions(fieldId: string): { value: ServerDefault; label: string }[] {
    const field = getFieldById(fieldId);
    if (!field) return [];
    return SERVER_DEFAULT_OPTIONS[field.type] ?? [];
  }

  function needsServerDefault(item: ObjectFieldReference): boolean {
    return item.appears === 'response' && !item.isPk;
  }

  function setServerDefault(fieldId: string, value: ServerDefault | undefined) {
    const newFields = editedItem.fields.map(f => {
      if (f.fieldId === fieldId) {
        return {
          ...f,
          serverDefault: value,
          defaultLiteral: value === 'literal' ? (f.defaultLiteral ?? '') : undefined
        };
      }
      return f;
    });
    editedItem = { ...editedItem, fields: newFields };
  }

  function setDefaultLiteral(fieldId: string, value: string) {
    const newFields = editedItem.fields.map(f => {
      if (f.fieldId === fieldId) {
        return { ...f, defaultLiteral: value };
      }
      return f;
    });
    editedItem = { ...editedItem, fields: newFields };
  }
```

Add `ServerDefault` to the type import at the top:

```typescript
  import type { ModelValidatorTemplate, InlineModelValidator, FieldAppearance, ObjectFieldReference, ObjectRelationship, Cardinality, ServerDefault } from '$lib/types';
```

- [ ] **Step 2: Add server default UI controls**

In the template section, find the "Optional Checkbox" section (around line 403). Add the server default controls **between** the Appears-in segmented control (line 401) and the Optional checkbox (line 403).

Insert after the closing `</div>` of the Appears-in segmented control (after line 401):

```svelte
                <!-- Server Default (shown for response-only non-PK fields) -->
                {#if needsServerDefault(item)}
                  {@const options = getServerDefaultOptions(item.fieldId)}
                  <div class="flex items-center gap-1.5">
                    <select
                      class="bg-mono-800 border border-mono-700 text-mono-300 text-xs rounded px-1.5 py-0.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 {!item.serverDefault ? 'border-red-700 text-red-400' : ''}"
                      value={item.serverDefault ?? ''}
                      onchange={(e) => setServerDefault(item.fieldId, (e.currentTarget.value as ServerDefault) || undefined)}
                    >
                      <option value="">Default…</option>
                      {#each options as opt}
                        <option value={opt.value}>{opt.label}</option>
                      {/each}
                    </select>
                    {#if item.serverDefault === 'literal'}
                      <input
                        type="text"
                        class="bg-mono-800 border border-mono-700 text-mono-300 text-xs rounded px-1.5 py-0.5 w-20 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 {!item.defaultLiteral ? 'border-red-700' : ''}"
                        placeholder="value"
                        value={item.defaultLiteral ?? ''}
                        oninput={(e) => setDefaultLiteral(item.fieldId, e.currentTarget.value)}
                      />
                    {/if}
                  </div>
                {/if}
```

- [ ] **Step 3: Fix toDomainFields to preserve serverDefault/defaultLiteral**

The `toDomainFields` function (line 66-73) constructs new objects with only 4 properties, silently erasing `serverDefault` and `defaultLiteral` on every drag-and-drop reorder. Update it to include the new fields:

```typescript
  function toDomainFields(items: DndItem[]): ObjectFieldReference[] {
    return items.map(item => ({
      fieldId: item.fieldId,
      optional: item.optional,
      isPk: item.isPk,
      appears: item.appears,
      serverDefault: item.serverDefault,
      defaultLiteral: item.defaultLiteral
    }));
  }
```

- [ ] **Step 5: Clear server default in toggleFieldPk**

When a field is promoted to PK, clear `serverDefault` and `defaultLiteral` to prevent stale values. Update `toggleFieldPk` (lines 125-132):

```typescript
    const newFields = editedItem.fields.map(f => {
      if (f.fieldId === fieldId) {
        const newIsPk = !f.isPk;
        return {
          ...f,
          isPk: newIsPk,
          optional: newIsPk ? false : f.optional,
          appears: newIsPk ? 'response' as const : f.appears,
          serverDefault: newIsPk ? undefined : f.serverDefault,
          defaultLiteral: newIsPk ? undefined : f.defaultLiteral
        };
      }
      return { ...f, isPk: false };
    });
```

- [ ] **Step 6: Auto-select server default when field type has only one option**

Update the `setFieldAppears` function to auto-select the server default when a field is switched to response-only and there's only one option:

```typescript
  function setFieldAppears(fieldId: string, value: FieldAppearance) {
    const fieldRef = editedItem.fields.find(f => f.fieldId === fieldId);
    if (!fieldRef || fieldRef.isPk) return;
    const newFields = editedItem.fields.map(f => {
      if (f.fieldId === fieldId) {
        const updated = { ...f, appears: value, optional: value === 'response' ? false : f.optional };
        // Auto-select server default when switching to response and there's only one option
        if (value === 'response' && !updated.isPk && !updated.serverDefault) {
          const options = getServerDefaultOptions(fieldId);
          if (options.length === 1) {
            updated.serverDefault = options[0].value;
          }
        }
        // Clear server default when switching away from response
        if (value !== 'response') {
          updated.serverDefault = undefined;
          updated.defaultLiteral = undefined;
        }
        return updated;
      }
      return f;
    });
    editedItem = { ...editedItem, fields: newFields };
  }
```

- [ ] **Step 7: Run dev server and verify UI**

```bash
cd frontend && bun run dev
```

Navigate to an Object editor, add a field, set it to "Res" (response-only), and verify:
- The server default dropdown appears
- Options are filtered by field type
- Selecting "Literal value" shows the text input
- Switching back to "Both" hides the controls

- [ ] **Step 8: Run type check**

```bash
cd frontend && bun run svelte-check --tsconfig ./tsconfig.json
```

Expected: PASS

- [ ] **Step 9: Commit**

```
feat(objects): add server default controls to object field editor

Show a server default dropdown when a field is set to response-only.
Options are filtered by field type. Literal strategy shows an
additional text input for the default value.
```

---

### Task 4: Frontend Validation

**Files:**
- Modify: `frontend/src/lib/stores/objectsModel.svelte.ts:174-182`

- [ ] **Step 1: Add server default validation**

In `frontend/src/lib/stores/objectsModel.svelte.ts`, update the `validate()` function (lines 174-182). Import `getFieldById` from `$lib/stores/fields` if not already imported.

```typescript
  function validate(item: ObjectDefinition): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!item.name.trim()) {
      errors.name = 'Object name is required';
    } else if (!isValidPascalCaseName(item.name)) {
      errors.name = 'Must be PascalCase (e.g. UserEmail)';
    }

    // Validate server defaults on response-only required non-PK fields.
    // Note: The spec also requires config.database.enabled == true, but the
    // frontend enforces this unconditionally because (a) the object editor
    // doesn't know the generation config, and (b) it's harmless to require
    // a server default even in non-database mode — the value is simply ignored.
    for (const fieldRef of item.fields) {
      if (fieldRef.appears === 'response' && !fieldRef.optional && !fieldRef.isPk) {
        if (!fieldRef.serverDefault) {
          const field = getFieldById(fieldRef.fieldId);
          const fieldName = field?.name ?? fieldRef.fieldId;
          errors[`field_${fieldRef.fieldId}_serverDefault`] =
            `Field "${fieldName}" is response-only and requires a server default`;
        } else if (fieldRef.serverDefault === 'literal' && !fieldRef.defaultLiteral) {
          const field = getFieldById(fieldRef.fieldId);
          const fieldName = field?.name ?? fieldRef.fieldId;
          errors[`field_${fieldRef.fieldId}_defaultLiteral`] =
            `Field "${fieldName}" has literal default but no value set`;
        }
      }
    }

    return errors;
  }
```

Add import for `getFieldById` if not already present:

```typescript
import { getFieldById } from '$lib/stores/fields';
```

- [ ] **Step 2: Show validation errors in ObjectFormContent**

The `visibleErrors` record is already passed to `ObjectFormContent` via props. The field-specific error keys (e.g., `field_<id>_serverDefault`) can be displayed in the field row.

In `ObjectFormContent.svelte`, add error display after the server default controls (inside the `{#if needsServerDefault(item)}` block):

```svelte
                    {#if visibleErrors[`field_${item.fieldId}_serverDefault`]}
                      <span class="text-red-500 text-[10px]" title={visibleErrors[`field_${item.fieldId}_serverDefault`]}>
                        <i class="fa-solid fa-circle-exclamation"></i>
                      </span>
                    {/if}
                    {#if visibleErrors[`field_${item.fieldId}_defaultLiteral`]}
                      <span class="text-red-500 text-[10px]" title={visibleErrors[`field_${item.fieldId}_defaultLiteral`]}>
                        <i class="fa-solid fa-circle-exclamation"></i>
                      </span>
                    {/if}
```

- [ ] **Step 3: Run type check**

```bash
cd frontend && bun run svelte-check --tsconfig ./tsconfig.json
```

Expected: PASS

- [ ] **Step 4: Run tests**

```bash
cd frontend && bunx vitest run
```

Expected: PASS

- [ ] **Step 5: Manual verification**

```bash
cd frontend && bun run dev
```

Verify:
1. Create an object with a response-only field, leave server default empty → form shows validation error, save is blocked
2. Select a server default → error clears, save succeeds
3. Select "Literal value" but leave value empty → shows literal validation error
4. Fill in literal value → error clears

- [ ] **Step 6: Commit**

```
feat(objects): add server default validation for response-only fields

Block saving objects where a response-only non-PK field has no server
default strategy configured. Validate that literal strategy has a value.
```

---

### Task 5: Cleanup + Final Verification

- [ ] **Step 1: Run full type check**

```bash
cd frontend && bun run svelte-check --tsconfig ./tsconfig.json
```

- [ ] **Step 2: Run unit tests**

```bash
cd frontend && bunx vitest run
```

- [ ] **Step 3: Run smoke E2E**

```bash
cd frontend && bunx playwright test --project=smoke
```

- [ ] **Step 4: Verify no stale references to defaultValue**

Search for any remaining references to the old `defaultValue` pattern that might conflict with the new `serverDefault`/`defaultLiteral` pattern:

```bash
cd frontend && grep -rn "defaultValue" src/lib/
```

`defaultValue` on `Field` (the reusable field entity) is unrelated to server defaults — it stays. Only verify there's no confusion between `Field.defaultValue` (field library) and `ObjectFieldReference.serverDefault` (object-field association).

- [ ] **Step 5: Commit if any cleanup was needed**

```
chore(objects): clean up server default implementation
```
