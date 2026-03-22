# Frontend Plan: Object Field Reference Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`

## Goal

Update the frontend TypeScript types, API layer, stores, and UI component to match the new `ObjectFieldReference` model — replacing `optional/appears/serverDefault/defaultLiteral` with `nullable/exposure/default` — and redesign the object field row UI to use an exposure dropdown instead of the PK toggle + Appears segmented control combination.

## Architecture

Four layers change:

1. **Types** (`src/lib/types/index.ts`) — new `ObjectFieldReference`, `FieldExposure`, `FieldDefault`
2. **API client** (`src/lib/api/objects.ts`) — update serialization between backend JSON and frontend types
3. **Stores** (`src/lib/stores/objectsModel.svelte.ts`, `src/lib/stores/apiDetailState.svelte.ts`) — update validation logic and all field-reference manipulations
4. **UI** (`src/lib/components/form/ObjectFormContent.svelte`) — redesign the field row

## Tech Stack

SvelteKit 5, Svelte 5 (runes), TypeScript, Tailwind CSS, Bun

## Prerequisite

**The backend must be updated with the matching API changes first.** The backend plan is at:
`docs/work/object-field-redesign/plan-backend.md`

The frontend relies on the new API contract defined in that plan. Do not start until the backend changes are deployed (or at least available locally for E2E testing).

## Working Directory

`frontend/` (symlink to the actual frontend repo — all paths below are relative to `frontend/`).

## Key Design Rules

- **No `rm -rf`** — use `find <dir> -delete` for directory removal
- **Strict cleanup** — when changing types, search entire codebase for affected references before marking done
- **Commit after each task** using the `/commit` skill — never `git commit` directly
- **Run type check after every task:** `bun run svelte-check --tsconfig ./tsconfig.json`
- **Run unit tests after every task:** `bunx vitest run`
- **Follow Conventional Commits:** `feat(types): ...`, `feat(api): ...`, `feat(ui): ...`

## New Field Row UI Design

```
[⠿] [id]         [int]      [Read-only ▾]   [autoincrement ▾] [🔑]  [✕]
[⠿] [name]       [str]      [Read/write ▾]                          [✕]
[⠿] [email]      [str]      [Read/write ▾]   [☑ Nullable]           [✕]
[⠿] [created_at] [datetime] [Read-only ▾]    [now ▾]                 [✕]
[⠿] [status]     [str]      [Read/write ▾]   ["active"] (input)     [✕]
[⠿] [password]   [str]      [Write-only ▾]                          [✕]
```

Controls per row (context-dependent, worst case = 5 controls + drag + delete):
1. Drag handle (always)
2. Field name + type badge (always)
3. **Exposure dropdown** — `Read/write | Write-only | Read-only` (always)
4. **Value source** — type-aware dropdown (`autoincrement | uuid4 | now | now_on_update | Literal`) shown for `read_only` non-PK fields, and a text input for `literal` value
5. **🔑 PK toggle** — shown for `read_only` `int`/`uuid` fields only; auto-selects obvious strategy
6. **☑ Nullable** — shown for `read_write` and `write_only` fields only
7. Delete button (always)

---

## Tasks

### Part 1: TypeScript Types

#### Task 1.1 — Update ObjectFieldReference and add supporting types

**File:** `src/lib/types/index.ts`

Find the `ObjectFieldReference` interface (around line 194) and the `FieldAppearance` and `ServerDefault` types.

1. Add new types **before** `ObjectFieldReference`:

   ```typescript
   export type FieldExposure = 'read_write' | 'write_only' | 'read_only';

   export interface FieldDefaultLiteral {
     kind: 'literal';
     value: string;
   }

   export interface FieldDefaultGenerated {
     kind: 'generated';
     strategy: 'uuid4' | 'now' | 'now_on_update' | 'auto_increment';
   }

   export type FieldDefault = FieldDefaultLiteral | FieldDefaultGenerated;
   ```

2. Replace `ObjectFieldReference`:

   ```typescript
   export interface ObjectFieldReference {
     fieldId: string;
     isPk: boolean;
     exposure: FieldExposure;
     nullable: boolean;
     default?: FieldDefault | null;
   }
   ```

3. Remove or deprecate `FieldAppearance` and `ServerDefault` types — search the entire codebase for usages before removing:
   ```bash
   grep -rn "FieldAppearance\|ServerDefault" src/
   ```
   If other files import them, update those imports first (likely only in `ObjectFormContent.svelte` and `objects.ts`).

**Type check:** `bun run svelte-check --tsconfig ./tsconfig.json`

**Test:** `bunx vitest run`

**Commit:** `feat(types): add FieldExposure, FieldDefault types and update ObjectFieldReference`

---

### Part 2: API Client Layer

#### Task 2.1 — Update objects API service

**File:** `src/lib/api/objects.ts`

1. Find `ObjectFieldReferenceResponse` (the shape the backend returns). Update it to match the new API contract:

   ```typescript
   interface ObjectFieldReferenceResponse {
     fieldId: string;
     isPk: boolean;
     exposure: string;
     nullable: boolean;
     default: { kind: string; value?: string; strategy?: string } | null;
   }
   ```

2. Find the deserialization function that maps `ObjectFieldReferenceResponse` → `ObjectFieldReference`. Update to map the new fields:

   ```typescript
   function deserializeFieldRef(raw: ObjectFieldReferenceResponse): ObjectFieldReference {
     let fieldDefault: FieldDefault | null = null;
     if (raw.default) {
       if (raw.default.kind === 'literal') {
         fieldDefault = { kind: 'literal', value: raw.default.value! };
       } else if (raw.default.kind === 'generated') {
         fieldDefault = { kind: 'generated', strategy: raw.default.strategy as FieldDefaultGenerated['strategy'] };
       }
     }
     return {
       fieldId: raw.fieldId,
       isPk: raw.isPk,
       exposure: raw.exposure as FieldExposure,
       nullable: raw.nullable,
       default: fieldDefault,
     };
   }
   ```

3. Find the serialization function that maps `ObjectFieldReference` → request payload. Update to send the new shape:

   ```typescript
   function serializeFieldRef(ref: ObjectFieldReference) {
     return {
       fieldId: ref.fieldId,
       isPk: ref.isPk,
       exposure: ref.exposure,
       nullable: ref.nullable,
       default: ref.default ?? null,
     };
   }
   ```

Remove old fields: `optional`, `appears`, `serverDefault`, `defaultLiteral`.

**Type check:** `bun run svelte-check --tsconfig ./tsconfig.json`

**Test:** `bunx vitest run` — update any API unit tests in `tests/unit/lib/api/objects.test.ts` to use the new payload shape.

**Commit:** `feat(api): update ObjectFieldReference serialization for new schema`

---

### Part 3: Stores

#### Task 3.1 — Update objectsModel store validation

**File:** `src/lib/stores/objectsModel.svelte.ts`

Find the validation logic (around line 191) that checks `fieldRef.appears === 'response'` and `fieldRef.serverDefault`. Rewrite to use the new model:

```typescript
// Old: appears === 'response' && !optional && !isPk → serverDefault required
// New: exposure === 'read_only' && !isPk → default required

for (const fieldRef of object.fields) {
  if (fieldRef.exposure === 'read_only' && !fieldRef.isPk) {
    if (!fieldRef.default) {
      errors[`field_${fieldRef.fieldId}_default`] =
        'Read-only fields must have a value source (generated or literal default)';
    } else if (fieldRef.default.kind === 'literal' && !fieldRef.default.value) {
      errors[`field_${fieldRef.fieldId}_defaultValue`] =
        'Literal default value cannot be empty';
    }
  }
}
```

Also search for all other references to `fieldRef.optional`, `fieldRef.appears`, `fieldRef.serverDefault`, `fieldRef.defaultLiteral` in this file and update them.

**Type check + test:** `bun run svelte-check --tsconfig ./tsconfig.json && bunx vitest run`

---

#### Task 3.2 — Update apiDetailState store

**File:** `src/lib/stores/apiDetailState.svelte.ts`

Search for references to `isPk` — these should still work since `isPk` is preserved. Also check for any references to `appears`, `optional`, `serverDefault`, `defaultLiteral` and update them.

The path param inference logic in `paramInference.ts` uses `isPk` to suggest path params — this should continue to work without changes if `isPk` is preserved.

Run:
```bash
grep -n "optional\|appears\|serverDefault\|defaultLiteral\|FieldAppearance\|ServerDefault" src/lib/stores/apiDetailState.svelte.ts
```

Update any found references.

**Type check + test:** `bun run svelte-check --tsconfig ./tsconfig.json && bunx vitest run`

**Commit:** `feat(stores): update objectsModel and apiDetailState for new ObjectFieldReference`

---

### Part 4: UI Component

#### Task 4.1 — Redesign the field row in ObjectFormContent

**File:** `src/lib/components/form/ObjectFormContent.svelte`

This is the most significant change. Read the full file before starting.

**Remove these controls from the row:**
- PK toggle button (standalone key icon button)
- `Both | Req | Res` segmented control (Appears)
- `Optional` checkbox
- Server default dropdown
- Literal value text input (standalone)
- Associated validation error icons

**Add these controls to the row:**
1. **Exposure dropdown** — replaces PK toggle + Appears segmented control

   Use a `<select>` or custom dropdown with three options:
   - `Read/write` (value: `read_write`)
   - `Write-only` (value: `write_only`)
   - `Read-only` (value: `read_only`)

   When `isPk=true`, force the exposure to `read_only` and disable the dropdown.

2. **Value source dropdown** — shown when `exposure === 'read_only' && !isPk`

   Type-aware options (use the same `SERVER_DEFAULT_OPTIONS` logic for type filtering, but now sourced from `FieldDefaultGenerated.strategy` values):
   - `autoincrement` (int only)
   - `uuid4` (uuid only)
   - `now` (datetime only)
   - `now + on update` (datetime only)
   - `Literal…` (all string/int/float types)

   When `Literal…` is selected, show a text input for the value.

3. **🔑 PK toggle** — shown when `exposure === 'read_only'` AND field type is `int` or `uuid`

   Toggling PK on:
   - Sets `isPk = true`
   - Auto-selects strategy: `int` → `auto_increment`, `uuid` → `uuid4`
   - Disables the exposure dropdown (locked to `read_only`)

   Toggling PK off:
   - Sets `isPk = false`
   - Clears the strategy if it was auto-selected

4. **☑ Nullable** — shown when `exposure === 'read_write'` OR `exposure === 'write_only'`

   Label: `Nullable` (not "Optional")

**Cascading state changes when exposure changes:**

```typescript
function setFieldExposure(fieldId: string, exposure: FieldExposure) {
  editedItem = {
    ...editedItem,
    fields: editedItem.fields.map(f => {
      if (f.fieldId !== fieldId) return f;

      const updated: ObjectFieldReference = {
        ...f,
        exposure,
        isPk: exposure !== 'read_only' ? false : f.isPk,
        nullable: exposure === 'read_only' ? false : f.nullable,
        // Clear default when switching away from read_only
        default: exposure !== 'read_only' ? null : f.default,
      };
      return updated;
    })
  };
}
```

**Error display:**
- Show error text inline below the value source control (not a tiny icon)
- Error: "Read-only fields must have a value source" when `exposure === 'read_only' && !isPk && !default`
- Error: "Only int and uuid fields can be primary keys" when toggling PK on invalid type

**Import cleanup:**
Remove imports of `FieldAppearance` and `ServerDefault` from `'$lib/types'`. Add `FieldExposure`, `FieldDefault`, `FieldDefaultLiteral`, `FieldDefaultGenerated`.

**Type check:** `bun run svelte-check --tsconfig ./tsconfig.json`

**Commit:** `feat(ui): redesign ObjectFormContent field row with exposure dropdown`

---

### Part 5: Tests

#### Task 5.1 — Update unit tests

Search for test files referencing old field property names:

```bash
grep -rn "optional\|appears\|serverDefault\|defaultLiteral\|FieldAppearance\|ServerDefault" tests/unit/
```

Update all fixtures and assertions to use the new property names. Key files likely affected:
- `tests/unit/lib/api/objects.test.ts`
- Any test that constructs `ObjectFieldReference` fixtures

**Test:** `bunx vitest run` — zero failures.

---

#### Task 5.2 — Update E2E tests

```bash
grep -rn "optional\|appears\|serverDefault\|defaultLiteral" tests/e2e/
```

Update `tests/e2e/crud/objects.spec.ts` — this test likely exercises the object editor. Update any assertions about the field row UI elements (Appears segmented control, Optional checkbox, etc.) to match the new Exposure dropdown and Nullable toggle.

**Note:** E2E tests that test the generate flow may also need updating if they assert on generated Python code output that was affected by field configuration.

**Commit:** `test(ui): update E2E tests for new field row UI`

---

### Part 6: Final Verification

```bash
bun run svelte-check --tsconfig ./tsconfig.json
bunx vitest run
```

For smoke E2E (requires dev server):
```bash
bunx playwright test --project=smoke
```

All must pass before declaring complete.

---

## Expected API Contract

This must match the backend plan exactly. See `docs/work/object-field-redesign/plan-backend.md` → "Expected API Contract" for the full JSON examples.

**Summary of breaking changes:**

| Old field | New field | Notes |
|-----------|-----------|-------|
| `optional: boolean` | `nullable: boolean` | Renamed |
| `appears: 'both'\|'request'\|'response'` | `exposure: 'read_write'\|'write_only'\|'read_only'` | Renamed + values changed |
| `serverDefault: string \| null` | `default.kind: 'generated'` + `default.strategy` | Merged into discriminated union |
| `defaultLiteral: string \| null` | `default.kind: 'literal'` + `default.value` | Merged into discriminated union |
| `isPk: boolean` | `isPk: boolean` | Unchanged |
