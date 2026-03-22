# Spec: Object Field Reference Redesign

## Problem

`ObjectFieldReference` has 5 independent properties (`optional`, `isPk`, `appears`, `serverDefault`, `defaultLiteral`) that create ~20 possible states with cascading side-effects. The UI crams up to 10 controls into a single horizontal row in a ~400px drawer — worst case on the most common fields (`id`, `created_at`, `status`).

Root causes:
- `optional` conflates DB nullability with request-schema omittability
- `appears` uses internal implementation terms (`both`, `request`, `response`) instead of user-mental-model terms
- `serverDefault` + `defaultLiteral` are a split discriminated union
- `serverDefault` is incorrectly restricted to response-only fields

## Design Decisions

### 1. New data model

```typescript
type FieldExposure = 'read_write' | 'write_only' | 'read_only';

type FieldDefault =
  | { kind: 'literal'; value: string }
  | { kind: 'generated'; strategy: 'uuid4' | 'now' | 'now_on_update' | 'auto_increment' };

interface ObjectFieldReference {
  fieldId: string;
  isPk: boolean;
  exposure: FieldExposure;   // replaces 'appears'
  nullable: boolean;          // replaces 'optional'
  default?: FieldDefault;     // merges serverDefault + defaultLiteral
}
```

### 2. Derivation rules (generator)

Schema membership (replaces schema_splitter `appears` logic):
- `read_write` → Create + Response schemas
- `write_only` → Create schema only
- `read_only` → Response schema only
- `isPk=true` → Response schema only (overrides exposure)

Request field requiredness (derived, not stored):
- `isPk=true` or `exposure === 'read_only'` → excluded from Create
- `default.kind === 'literal'` on `read_write`/`write_only` → `field: type = "value"` (omittable, Pydantic schema default)
- `nullable=true` → `field: type | None = None`
- otherwise → `field: type` (required)

**Schema defaults apply to Create schema only.** Update schema always uses `field: type | None = None` (because `views.mako` uses `exclude_unset=True` for PATCH — applying defaults to Update would corrupt partial-update semantics).

ORM defaults (from `default` field):
- `default.kind === 'literal'` on `read_only` → `server_default="value"` on Column
- `default.kind === 'literal'` on `read_write`/`write_only` → also mirror as `server_default="value"` on Column (DB safety net)
- `default.kind === 'generated'` → `server_default=func.now()` / autoincrement / uuid4 on Column

### 3. Write-only fields kept

`write_only` (was `request`) represents the password pattern — client sends, API never returns. This is common enough to be first-class (not post-generation).

### 4. Nullable scope

`nullable` only meaningfully applies to `read_write` and `write_only` fields. `read_only` fields are forced `nullable=false` (server always writes a value).

### 5. UI row design

Inline row (no expandable panel) — cleaner enough at 5 controls max:

```
[⠿] [id]         [int]      [Read-only ▾]   [autoincrement ▾] [🔑]  [✕]
[⠿] [name]       [str]      [Read/write ▾]                          [✕]
[⠿] [email]      [str]      [Read/write ▾]   [☑ Nullable]           [✕]
[⠿] [created_at] [datetime] [Read-only ▾]    [now ▾]                 [✕]
[⠿] [status]     [str]      [Read/write ▾]   ["active"]             [✕]
[⠿] [password]   [str]      [Write-only ▾]                          [✕]
```

Controls per row (context-dependent):
1. Drag handle (always)
2. Field name (always)
3. Type badge (always)
4. **Exposure dropdown** — `Read/write | Write-only | Read-only` (always)
5. **Value source dropdown** — for `read_only` non-PK fields (type-aware: generated strategies + Literal option)
6. **Literal input** — when value source is "Literal"
7. **🔑 PK toggle** — for `read_only` `int`/`uuid` fields
8. **☑ Nullable** — for `read_write` and `write_only` fields
9. Delete (always)

### 6. DB controls always visible

All controls shown regardless of whether DB generation is enabled (DB is a paid add-on selected at generate time, not at configuration time). FOMO mechanic: user configures DB properties, then is incentivized to enable DB generation.

### 7. Existing field-level `defaultValue`

The `Field` entity already has a `defaultValue` property (exists in frontend + backend). Generation currently ignores it. It remains unused by generation — it can serve as a **prefill suggestion** when adding a field to an object (UX convenience, not source of truth).

## Migration Strategy

Modify the existing initial migration (`4141ad7f2255_initial_schema.py`) in-place — no new migration file.

Column changes on `fields_on_objects`:
- `optional` → `nullable` (rename)
- `appears` → `exposure` (rename), CHECK values: `both→read_write`, `request→write_only`, `response→read_only`
- `server_default` → `default_kind` TEXT NULL (CHECK: `literal`, `generated`)
- `default_literal` → `default_value` TEXT NULL

## API Contract

See `plan-backend.md` → Expected API Contract section.
