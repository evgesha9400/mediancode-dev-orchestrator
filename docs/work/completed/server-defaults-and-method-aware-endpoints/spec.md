# Spec: Server Defaults & Method-Aware Endpoints

## Problem

Two related issues with how endpoints handle request/response bodies:

### 1. Response-only fields produce broken code

When a field is marked `appears: 'response'` (e.g. `created_at`), it is excluded from Create/Update Pydantic schemas. The generated POST handler does `OrmClass(**request.model_dump())`, so response-only fields receive no value. The database column is NULL, violating NOT NULL constraints and returning empty data.

Only PK fields work because `orm_builder.py` already handles `uuid_default` and `autoincrement` for primary keys. No equivalent mechanism exists for non-PK response-only fields.

The existing `default_value` field on `InputField` and `TemplateField` is dead code — it is never rendered in any template (`models.mako`, `orm_models.mako`, `initial_migration.mako`).

### 2. All methods blindly set both request and response to the same object

The generation service (`api/services/generation.py`) previously set `request=object_name` and `response=object_name` for all HTTP methods. This was fixed in an earlier commit to be method-aware:
- GET: `request=None`, `response=object_name`
- POST: `request=object_name`, `response=object_name`
- PUT/PATCH: `request=object_name`, `response=object_name`
- DELETE: `request=None`, `response=None`

The frontend `ResponsePreview` component was also updated to be method-aware. **This part is already done.**

## Philosophy Alignment

Per `docs/PHILOSOPHY.md`:

- **Structural**: Server defaults are database-level column metadata, not business logic
- **Deterministic**: A small enum of named strategies — same input always produces the same ORM/migration output
- **>80% of projects**: `created_at`, `updated_at`, UUID identifiers, and literal defaults (e.g. `status = "active"`) are universal
- **UI constraint**: The UI must not allow configurations that produce broken code. Every valid configuration generates working, deployable code

## Design

### Server Default Strategies

A new `ServerDefault` enum with five values:

| Strategy | ORM Output | Migration Output | Valid Field Types |
|----------|-----------|-----------------|-------------------|
| `uuid4` | `default=uuid.uuid4` | (no DDL default — Python-side) | `uuid`, `UUID` |
| `now` | `server_default=func.now()` | `server_default=sa.func.now()` | `datetime`, `date` |
| `now_on_update` | `server_default=func.now()`, `onupdate=func.now()` | `server_default=sa.func.now()` | `datetime`, `date` |
| `auto_increment` | `autoincrement=True` | `autoincrement=True` | `int` |
| `literal` | `server_default="<value>"` | `server_default="<value>"` | `str`, `bool`, `int`, `float` |

For `literal`, a separate `default_literal` field stores the typed constant value. This replaces the dead `default_value` field.

### Validation Rule

**Backend enforcement** (in `validators.py`):

A field triggers the rule when ALL of these are true:
- `appears == "response"`
- `optional == False`
- `pk == False`
- Database generation is enabled (`config.database.enabled == True`)

When triggered: `server_default` MUST be set. If not, raise a `ValueError` at validation time.

**Type compatibility** must also be enforced:
- `uuid4` only for `uuid`/`UUID` type fields
- `now` and `now_on_update` only for `datetime`/`date` type fields
- `auto_increment` only for `int` type fields
- `literal` only for `str`, `bool`, `int`, `float`

**PK fields are exempt** — they already have their own auto-generation via `uuid_default` and `autoincrement` in `orm_builder.py`.

**Non-database mode**: When `config.database.enabled == False`, server defaults are irrelevant (views return placeholder data). The validation rule does not apply.

### No escape hatch

If none of the strategies fit, the user picks the closest one (e.g. `literal` with a reasonable default) and replaces it post-generation. This keeps every UI configuration producing correct, deployable code with no broken schemas.

### Where the strategy lives

The `server_default` is attached to the **object-field association** (`fields_on_objects` table), not the reusable field definition. This matches where `optional`, `is_pk`, and `appears` already live — the same field can have different strategies on different objects.

## Current State Reference

### Backend — Code Generation (`api_craft`)

| File | Current State | Change Needed |
|------|--------------|---------------|
| `models/enums.py` | No `ServerDefault` type | Add `ServerDefault` literal |
| `models/input.py` | `InputField.default_value: str \| None` (dead) | Replace with `server_default: ServerDefault \| None` and `default_literal: str \| None` |
| `models/template.py` | `TemplateField.default_value: str \| None` (dead) | Remove. `TemplateORMField` gets new fields: `server_default`, `on_update`, `default_literal` |
| `models/template.py` | `TemplateORMField` has `autoincrement`, `uuid_default` bools | Replace with generic `server_default` + `on_update` + `default_literal` fields. `autoincrement` and `uuid_default` become special cases of `server_default` |
| `models/validators.py` | No server default validation | Add `validate_server_defaults()` |
| `orm_builder.py` | Only handles PK auto-gen (lines 124-134) | Extend to handle all `server_default` strategies for non-PK fields |
| `schema_splitter.py` | Filters by `appears` and `pk` | No changes needed |
| `transformers.py` | Passes `default_value` through but unused | Remove `default_value` pass-through |
| `templates/orm_models.mako` | Renders `autoincrement`, `uuid_default` on PK fields | Render `server_default=func.now()`, `onupdate=func.now()`, `server_default="literal"` for non-PK fields. Add `func` import when needed |
| `templates/initial_migration.mako` | No server defaults in DDL | Emit `server_default=sa.func.now()` and `server_default="value"` on columns |
| `templates/models.mako` | Never renders `default_value` | No changes needed |
| `templates/views.mako` | Method-aware (already fixed) | No changes needed |

### Backend — REST API (`api`)

| File | Current State | Change Needed |
|------|--------------|---------------|
| `models/database.py` | `FieldModel.default_value` column, `ObjectFieldAssociation.appears` column | Add `server_default` and `default_literal` columns to `ObjectFieldAssociation`. Keep `default_value` on `FieldModel` for now (backward compat, can deprecate later) |
| `schemas/object.py` | Exposes `appears` on field references | Add `serverDefault` and `defaultLiteral` to object field schemas |
| `services/generation.py` | Passes `field.default_value` to `InputField` (line 211) | Pass `assoc.server_default` and `assoc.default_literal` instead |

### Frontend

| File | Current State | Change Needed |
|------|--------------|---------------|
| `types/index.ts` | `FieldAppearance = 'both' \| 'request' \| 'response'`, `ObjectFieldReference` has `appears` | Add `serverDefault` and `defaultLiteral` to `ObjectFieldReference` |
| Field editor UI | `appears` dropdown exists | When `appears='response'` AND `optional=false` AND `isPk=false`: show `serverDefault` dropdown (required). When `literal` selected: show `defaultLiteral` input |
| Validation | No client-side enforcement | Add validation: response + required + non-PK must have `serverDefault` |
| `ResponsePreview` | Already method-aware | No changes needed |

## Out of Scope

- **Per-method field granularity** (Create vs Update distinction): Parked in `docs/ideas/per-method-field-visibility.md`. The current `both | request | response` is sufficient for >80% of cases.
- **Per-endpoint schema overrides** (include/exclude patches): Future enhancement, not needed for v1.
- **Removing `default_value` from `FieldModel`**: Backward compatibility concern. Can deprecate in a separate migration.
- **Non-database mode changes**: Server defaults are irrelevant when `database.enabled = False`. No UI changes needed for that mode.
