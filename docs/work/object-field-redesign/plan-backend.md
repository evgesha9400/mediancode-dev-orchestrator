# Backend Plan: Object Field Reference Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`

## Goal

Replace the 5-property `ObjectFieldReference` model (`optional`, `isPk`, `appears`, `serverDefault`, `defaultLiteral`) with a cleaner 4-property model (`isPk`, `exposure`, `nullable`, `default`) across the backend API schemas, DB model, and code generation engine.

## Architecture

The change touches four layers:

1. **Enum definitions** (`src/api_craft/models/enums.py`, `src/api/schemas/literals.py`) — add `FieldExposure`, restructure `ServerDefault` into `GeneratedStrategy`
2. **Input model** (`src/api_craft/models/input.py`) — update `InputField` with new properties and a `FieldDefault` discriminated union
3. **API + DB layer** (`src/api/schemas/object.py`, `src/api/models/database.py`, migration, services, router) — rename columns, update schemas, update service mapping
4. **Generation engine** (`src/api_craft/models/validators.py`, `src/api_craft/schema_splitter.py`, `src/api_craft/prepare.py`, `src/api_craft/orm_builder.py`) — update derivation rules

The backend `InputField` is the shared contract between the API layer and the generation engine. All changes flow from it.

## Tech Stack

Python 3.13, FastAPI, SQLAlchemy 2.x, Pydantic v2, Alembic, pytest

## Prerequisite

None — backend executes first.

Read the spec at `docs/work/object-field-redesign/spec.md` before starting.

## Working Directory

`backend/` (this is a symlink to the actual backend repo — all paths below are relative to `backend/`).

## Key Design Rules

- **No new migration files.** Modify the existing initial migration `src/api/migrations/versions/4141ad7f2255_initial_schema.py` in-place.
- **Always format after changes:** `poetry run black src/ tests/`
- **Always run both test suites:** `make test` AND `make test-e2e`
- **Follow Conventional Commits:** `feat(api): ...`, `feat(generation): ...`

---

## Tasks

### Part 1: Enums and Input Model

#### Task 1.1 — Update enums

**File:** `src/api_craft/models/enums.py`

1. Add `FieldExposure` literal type:
   ```python
   FieldExposure = Literal["read_write", "write_only", "read_only"]
   ```

2. Keep `FieldAppearance` temporarily as an alias for backward compat during migration:
   ```python
   FieldAppearance = FieldExposure  # deprecated alias, remove after full migration
   ```

3. Rename `ServerDefault` values to `GeneratedStrategy` (the old "literal" value is no longer part of this enum — it is now handled by `FieldDefault.kind`):
   ```python
   GeneratedStrategy = Literal["uuid4", "now", "now_on_update", "auto_increment"]
   ```
   Keep `ServerDefault` as an alias for now: `ServerDefault = GeneratedStrategy`

4. Add `DefaultKind`:
   ```python
   DefaultKind = Literal["literal", "generated"]
   ```

**Format:** `poetry run black src/api_craft/models/enums.py`

**Test:** `make test` — confirm no import errors.

**Commit:** `feat(models): add FieldExposure and GeneratedStrategy enums`

---

#### Task 1.2 — Add FieldDefault discriminated union to InputField

**File:** `src/api_craft/models/input.py`

1. Add two new Pydantic models and a union type **before** the `InputField` class:
   ```python
   class FieldDefaultLiteral(BaseModel):
       kind: Literal["literal"]
       value: str

   class FieldDefaultGenerated(BaseModel):
       kind: Literal["generated"]
       strategy: GeneratedStrategy  # import from enums

   FieldDefault = Annotated[
       FieldDefaultLiteral | FieldDefaultGenerated,
       Field(discriminator="kind")
   ]
   ```
   (Import `Annotated` from `typing` and `GeneratedStrategy` from `api_craft.models.enums`.)

2. In `InputField`, replace:
   - `optional: bool` → `nullable: bool`
   - `appears: FieldAppearance` → `exposure: FieldExposure`
   - `server_default: ServerDefault | None` → remove
   - `default_literal: str | None` → remove
   - Add: `default: FieldDefault | None = None`

   Also update `pk` field if needed — keep as-is (`pk: bool`).

3. Update the `model_validator` on `InputField` if one exists — remove any logic referencing `optional`, `appears`, `server_default`, or `default_literal`.

**Format:** `poetry run black src/api_craft/models/input.py`

**Test:** `make test` — expect failures in generation engine (will fix in Part 4). Fix any import errors first.

**Commit:** `feat(models): replace optional/appears/serverDefault with nullable/exposure/default on InputField`

---

### Part 2: API Schemas, DB Model, and Migration

#### Task 2.1 — Update API schemas

**File:** `src/api/schemas/literals.py`

Add `FieldExposure` and `GeneratedStrategy` imports from `api_craft.models.enums`. Keep `FieldAppearance` and `ServerDefault` as re-exports for now if anything else imports them.

---

**File:** `src/api/schemas/object.py`

1. Add a `FieldDefaultSchema` discriminated union matching the API JSON shape:
   ```python
   from typing import Annotated, Literal
   from pydantic import Field as PydanticField

   class FieldDefaultLiteralSchema(BaseModel):
       kind: Literal["literal"]
       value: str

   class FieldDefaultGeneratedSchema(BaseModel):
       kind: Literal["generated"]
       strategy: Literal["uuid4", "now", "now_on_update", "auto_increment"]

   FieldDefaultSchema = Annotated[
       FieldDefaultLiteralSchema | FieldDefaultGeneratedSchema,
       PydanticField(discriminator="kind")
   ]
   ```

2. Replace `ObjectFieldReferenceSchema`:
   ```python
   class ObjectFieldReferenceSchema(BaseModel):
       """Schema for a field reference in an object."""
       model_config = ConfigDict(populate_by_name=True)

       field_id: UUID = Field(..., alias="fieldId")
       is_pk: bool = Field(default=False, alias="isPk")
       exposure: FieldExposure = Field(default="read_write")
       nullable: bool = Field(default=False)
       default: FieldDefaultSchema | None = Field(default=None)
   ```

   Remove old fields: `optional`, `appears`, `server_default`, `default_literal`.

**Format:** `poetry run black src/api/schemas/object.py src/api/schemas/literals.py`

---

#### Task 2.2 — Update the DB model

**File:** `src/api/models/database.py`

Find the `ObjectFieldAssociation` class (around line 452). Update columns:

1. Rename `optional` → `nullable`:
   ```python
   nullable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
   ```

2. Rename `appears` → `exposure`, update server_default and type:
   ```python
   exposure: Mapped[str] = mapped_column(
       Text, nullable=False, server_default="read_write"
   )
   ```
   (CHECK constraint will be updated in the migration.)

3. Replace `server_default` column with `default_kind`:
   ```python
   default_kind: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

4. Replace `default_literal` column with `default_value`:
   ```python
   default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

Update the docstring for the class accordingly.

**Format:** `poetry run black src/api/models/database.py`

---

#### Task 2.3 — Update the migration in-place

**File:** `src/api/migrations/versions/4141ad7f2255_initial_schema.py`

Find the `fields_on_objects` table creation block. Make these changes:

1. Rename `optional` → `nullable`:
   ```python
   sa.Column("nullable", sa.Boolean(), nullable=False, server_default=sa.false()),
   ```

2. Rename `appears` → `exposure`, update server_default value and CHECK constraint:
   ```python
   sa.Column("exposure", sa.Text(), nullable=False, server_default="read_write"),
   ```
   Update the CHECK constraint name and values:
   ```python
   sa.CheckConstraint(
       "exposure IN ('read_write', 'write_only', 'read_only')",
       name="ck_fields_on_objects_exposure"
   ),
   ```
   Remove old `ck_fields_on_objects_appears` constraint.

3. Replace `server_default` column with `default_kind`:
   ```python
   sa.Column("default_kind", sa.Text(), nullable=True),
   sa.CheckConstraint(
       "default_kind IN ('literal', 'generated') OR default_kind IS NULL",
       name="ck_fields_on_objects_default_kind"
   ),
   ```

4. Replace `default_literal` column with `default_value`:
   ```python
   sa.Column("default_value", sa.Text(), nullable=True),
   ```

Also check `src/api/migrations/versions/b1a2c3d4e5f6_seed_system_data.py` for any references to `optional`, `appears`, `server_default`, `default_literal` field names in INSERT statements and update them.

**Format:** `poetry run black src/api/migrations/versions/`

---

#### Task 2.4 — Update the router

**File:** `src/api/routers/objects.py`

Find where `ObjectFieldReferenceSchema` fields are mapped (around line 43). Update references from `optional`/`appears`/`is_pk` aliases to new field names. Ensure `field_id`, `is_pk`, `exposure`, `nullable`, `default` are all passed through correctly.

**Format:** `poetry run black src/api/routers/objects.py`

---

#### Task 2.5 — Update the object service

**File:** `src/api/services/object.py`

Find where `ObjectFieldAssociation` is created/updated from the incoming schema (around line 191). Update the field mapping:
- `optional=...` → `nullable=...`
- `appears=...` → `exposure=...`
- `server_default=...` → `default_kind=...` (extract from `schema.default.kind` if `schema.default` is not None)
- `default_literal=...` → `default_value=...` (extract from `schema.default.value` if literal, or `schema.default.strategy` if generated)

**Format:** `poetry run black src/api/services/object.py`

---

#### Task 2.6 — Update the generation service

**File:** `src/api/services/generation.py`

Find where `InputField` is constructed from the DB association model (around lines 209, 219, 292). Update:
- `optional=assoc.optional` → `nullable=assoc.nullable`
- `appears=assoc.appears` → `exposure=assoc.exposure`
- Remove `server_default=assoc.server_default`
- Remove `default_literal=assoc.default_literal`
- Add:
  ```python
  default=(
      FieldDefaultLiteral(kind="literal", value=assoc.default_value)
      if assoc.default_kind == "literal"
      else FieldDefaultGenerated(kind="generated", strategy=assoc.default_value)
      if assoc.default_kind == "generated"
      else None
  ),
  ```

Import `FieldDefaultLiteral`, `FieldDefaultGenerated` from `api_craft.models.input`.

**Format:** `poetry run black src/api/services/generation.py`

**Test:** `make test` — fix import and construction errors.

**Commit:** `feat(api): update ObjectFieldReference API schemas, DB model, migration, and services`

---

### Part 3: Seeding Data

#### Task 3.1 — Update shop_data.py

**File:** `src/api/seeding/shop_data.py`

Find all field references in the seeding data. Update:
- `"optional": False/True` → `"nullable": False/True`
- `"is_pk": ...` → unchanged
- `"appears": "both"` → `"exposure": "read_write"`
- `"appears": "request"` → `"exposure": "write_only"`
- `"appears": "response"` → `"exposure": "read_only"`
- `"server_default": "now"` → `"default_kind": "generated", "default_value": "now"`
- `"server_default": "uuid4"` → `"default_kind": "generated", "default_value": "uuid4"`
- `"server_default": "auto_increment"` → `"default_kind": "generated", "default_value": "auto_increment"`
- `"server_default": "literal", "default_literal": "X"` → `"default_kind": "literal", "default_value": "X"`
- Remove any `"default_literal"` keys (value is now in `default_value`)

**Format:** `poetry run black src/api/seeding/`

**Test:** `make test`

**Commit:** `feat(api): update seeding data for new field reference schema`

---

### Part 4: Generation Engine

#### Task 4.1 — Update validators

**File:** `src/api_craft/models/validators.py`

Find `validate_server_defaults` (around line 280). Rewrite to use the new model:

```python
def validate_server_defaults(objects, database_config):
    """Validate default constraints on fields.

    Rules:
    1. read_only non-PK fields (with DB enabled) must have a default
    2. generated strategy must be compatible with the field's type
    3. isPk=True forces exposure='read_only'
    """
    for obj in objects:
        for field in obj.fields:
            if field.pk:
                # PK fields must be read_only
                if field.exposure != "read_only":
                    raise ValueError(
                        f"Field '{obj.name}.{field.name}': primary key must be read_only"
                    )
                continue

            # Rule 1: read_only + non-PK + DB enabled → must have a default
            if (
                field.exposure == "read_only"
                and field.default is None
                and database_config
                and database_config.enabled
            ):
                raise ValueError(
                    f"Field '{obj.name}.{field.name}': read_only field "
                    f"has no default. Set a default strategy."
                )

            # Rule 2: generated strategy must match field type
            if field.default and field.default.kind == "generated":
                strategy = field.default.strategy
                # Use existing SERVER_DEFAULT_VALID_TYPES map, but keyed by strategy
                valid_types = SERVER_DEFAULT_VALID_TYPES.get(strategy, set())
                if field.type not in valid_types:
                    raise ValueError(
                        f"Field '{obj.name}.{field.name}': strategy '{strategy}' "
                        f"is not compatible with type '{field.type}'"
                    )
```

Also update `validate_primary_keys` and `validate_pk_field_types` — replace any references to `field.appears` with `field.exposure` and `field.pk` (which is unchanged).

Update `SERVER_DEFAULT_VALID_TYPES` to remove `"literal"` key if present (literal is now handled separately).

**Format:** `poetry run black src/api_craft/models/validators.py`

---

#### Task 4.2 — Update schema_splitter

**File:** `src/api_craft/schema_splitter.py`

Replace all references to `field.appears` with `field.exposure`, and update the value comparisons:

- `field.appears in ("both", "request")` → `field.exposure in ("read_write", "write_only")`
- `field.appears in ("both", "response")` → `field.exposure in ("read_write", "read_only")`
- `field.appears == "request"` → `field.exposure == "write_only"`
- `field.appears == "response"` → `field.exposure == "read_only"`
- `field.appears == "both"` → `field.exposure == "read_write"`

Also update `_has_appears_flags` and `_model_needs_split` functions to use the new values. Update any references to `FieldAppearance` import to use `FieldExposure`.

**Format:** `poetry run black src/api_craft/schema_splitter.py`

---

#### Task 4.3 — Update prepare.py render_field

**File:** `src/api_craft/prepare.py`

Find `render_field` (around line 196). Update it to handle the new `FieldDefault` model.

The function receives an `InputField` and optionally a `force_optional: bool` flag (for Update schemas). The new logic:

```python
def render_field(field: InputField, force_optional: bool = False) -> str:
    type_annotation = _build_type_annotation(field)  # existing logic
    constraints = [render_field_constraint(v) for v in (field.validators or [])]
    field_args = ", ".join(c for c in constraints if c)

    if force_optional:
        # Update schema: all fields become Type | None = None
        # Never apply literal defaults on Update (exclude_unset=True in PATCH)
        if field_args:
            return f"{field.name}: {type_annotation} | None = Field(default=None, {field_args})"
        return f"{field.name}: {type_annotation} | None = None"

    # Create/Response schema
    if field.default and field.default.kind == "literal":
        # Literal default: field is omittable, Pydantic schema default
        value = repr(field.default.value)
        if field_args:
            return f"{field.name}: {type_annotation} = Field(default={value}, {field_args})"
        return f"{field.name}: {type_annotation} = {value}"

    if field.nullable:
        if field_args:
            return f"{field.name}: {type_annotation} | None = Field(default=None, {field_args})"
        return f"{field.name}: {type_annotation} | None = None"

    # Required field
    if field_args:
        return f"{field.name}: {type_annotation} = Field({field_args})"
    return f"{field.name}: {type_annotation}"
```

Notes:
- Literal defaults apply to **Create** schema only. The schema_splitter already excludes `read_only` fields from Create, so `render_field` does not need to filter by exposure — it just renders what it receives.
- Response schema fields receive the same field objects but `force_optional` is not set, and `read_only` fields will have a `default` (required by validator), which is a generated default — not a literal. So the `default.kind == 'literal'` branch won't fire for Response-only fields unless they have a literal default intentionally.
- `_compute_pydantic_imports` (around line 219) may need updating if it references `field.optional`.

Also scan `prepare.py` for any other references to `field.optional`, `field.appears`, `field.server_default`, `field.default_literal` and update them.

**Format:** `poetry run black src/api_craft/prepare.py`

---

#### Task 4.4 — Update orm_builder

**File:** `src/api_craft/orm_builder.py`

Find where `InputField` properties are used to build `TemplateORMField`. Update:

1. Replace `field.optional` → `field.nullable` for the `nullable` column attribute.

2. Replace the server_default logic. Currently uses `field.server_default` and `field.default_literal`. New logic:

   ```python
   server_default = None
   on_update = None

   if field.default:
       if field.default.kind == "literal":
           server_default = repr(field.default.value)  # e.g., "'active'"
       elif field.default.kind == "generated":
           strategy = field.default.strategy
           if strategy == "now":
               server_default = "func.now()"
           elif strategy == "now_on_update":
               server_default = "func.now()"
               on_update = "func.now()"
           elif strategy == "uuid4":
               server_default = "text('gen_random_uuid()')"
           elif strategy == "auto_increment":
               # auto_increment is handled by primary_key=True + autoincrement on Column
               server_default = None
   ```

3. Also update any `field.pk` reference if the attribute is renamed — it should stay as `field.pk` on `InputField` (`pk: bool`), but the mapping to `TemplateORMField.primary_key` should still work.

**Format:** `poetry run black src/api_craft/orm_builder.py`

**Test:** `make test` — fix all remaining failures.

**Commit:** `feat(generation): update validators, schema_splitter, prepare, and orm_builder for new field model`

---

### Part 5: Tests

#### Task 5.1 — Update unit tests

Search for tests referencing old field property names:

```bash
grep -rn "optional\|appears\|serverDefault\|server_default\|defaultLiteral\|default_literal" tests/
```

Update all test fixtures and assertions to use the new names:
- `optional` → `nullable`
- `appears` → `exposure`
- `"both"` → `"read_write"`, `"request"` → `"write_only"`, `"response"` → `"read_only"`
- `server_default` + `default_literal` → `default_kind` + `default_value` (in DB/fixture context) or `default: { kind: ..., ... }` (in API payload context)

**Format:** `poetry run black tests/`

**Test:** `make test` — all unit tests must pass.

---

#### Task 5.2 — Run E2E tests and fix failures

```bash
make test-e2e
```

Fix any E2E failures caused by the API contract change. E2E tests likely POST/PUT field references using the old payload shape — update the test fixtures and request payloads.

**Test:** `make test` AND `make test-e2e` — zero failures.

**Commit:** `test(api): update tests for new ObjectFieldReference schema`

---

### Part 6: Final Verification

Run the complete suite:

```bash
make test
make test-e2e
poetry run black src/ tests/ --check
```

All must pass with zero failures before declaring complete.

**Commit:** Only if there are any remaining formatting fixes.

---

## Expected API Contract

### ObjectFieldReference in object creation/update payload

**Old shape:**
```json
{
  "fieldId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "optional": false,
  "isPk": false,
  "appears": "both",
  "serverDefault": null,
  "defaultLiteral": null
}
```

**New shape:**
```json
{
  "fieldId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "isPk": false,
  "exposure": "read_write",
  "nullable": false,
  "default": null
}
```

### Common field patterns

**Primary key (int, auto-increment):**
```json
{
  "fieldId": "...",
  "isPk": true,
  "exposure": "read_only",
  "nullable": false,
  "default": { "kind": "generated", "strategy": "auto_increment" }
}
```

**Primary key (uuid):**
```json
{
  "fieldId": "...",
  "isPk": true,
  "exposure": "read_only",
  "nullable": false,
  "default": { "kind": "generated", "strategy": "uuid4" }
}
```

**Server-managed timestamp (created_at):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "read_only",
  "nullable": false,
  "default": { "kind": "generated", "strategy": "now" }
}
```

**Server-managed timestamp (updated_at):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "read_only",
  "nullable": false,
  "default": { "kind": "generated", "strategy": "now_on_update" }
}
```

**Standard field with literal default (status):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "read_write",
  "nullable": false,
  "default": { "kind": "literal", "value": "active" }
}
```

**Optional standard field (email):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "read_write",
  "nullable": true,
  "default": null
}
```

**Required standard field (name):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "read_write",
  "nullable": false,
  "default": null
}
```

**Write-only field (password):**
```json
{
  "fieldId": "...",
  "isPk": false,
  "exposure": "write_only",
  "nullable": false,
  "default": null
}
```
