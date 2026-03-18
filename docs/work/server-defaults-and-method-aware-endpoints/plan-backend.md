# Server Defaults — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server default strategies to the code generation pipeline so response-only required fields produce working, deployable code. Subsume PK auto-gen into the same mechanism. Expose server defaults through the REST API.

**Architecture:** Add `ServerDefault` Literal type, replace dead `default_value` with `server_default` + `default_literal` on InputField, propagate through `orm_builder` to `TemplateORMField`, and render in Mako templates. Update REST API layer (database model, schema, generation service) to persist and pass through server defaults.

**Tech Stack:** Python 3.13+, Pydantic v2, SQLAlchemy 2.x, Mako templates, FastAPI, Alembic, PostgreSQL

**Spec:** `docs/work/server-defaults-and-method-aware-endpoints/spec.md`

---

## File Structure

### api_craft (code generation library)

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/api_craft/models/enums.py` | Add `ServerDefault` Literal type |
| Modify | `src/api_craft/models/input.py:65-86` | Replace `default_value` with `server_default` + `default_literal` on `InputField` |
| Modify | `src/api_craft/models/validators.py` | Add `validate_server_defaults()` with type compatibility checks |
| Modify | `src/api_craft/models/template.py:33-44` | Remove `default_value` from `TemplateField` |
| Modify | `src/api_craft/models/template.py:114-125` | Replace `autoincrement`/`uuid_default` with `server_default`/`on_update`/`default_literal` on `TemplateORMField` |
| Modify | `src/api_craft/transformers.py:100-109` | Remove `default_value` pass-through from `transform_field()` |
| Modify | `src/api_craft/orm_builder.py:113-135` | Replace hardcoded PK auto-gen with generic `server_default` mapping |
| Modify | `src/api_craft/templates/orm_models.mako:7-26,59-75` | Render all server_default strategies; add `func` import when needed |
| Modify | `src/api_craft/templates/initial_migration.mako:27-33` | Emit `server_default` on migration columns |

### api (REST service)

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/api/models/database.py:457-498` | Add `server_default`, `default_literal` columns to `ObjectFieldAssociation` |
| Modify | `src/api/schemas/object.py:13-30` | Add `serverDefault`, `defaultLiteral` to `ObjectFieldReferenceSchema` |
| Modify | `src/api/schemas/literals.py` | Re-export `ServerDefault` from `api_craft.models.enums` |
| Modify | `src/api/services/generation.py:204-219` | Pass `assoc.server_default`/`assoc.default_literal` to `InputField` |
| Modify | `src/api/migrations/versions/4141ad7f2255_initial_schema.py:310-334` | Add columns + CHECK constraint to `fields_on_objects` table |

### Tests

| Action | File | What changes |
|--------|------|-------------|
| Modify | `tests/test_api_craft/test_input_models.py` | Add `TestServerDefaultValidation` class |
| Modify | `tests/test_api_craft/test_transformers.py` | Update ORM field assertions: `autoincrement`/`uuid_default` → `server_default` |
| Modify | `tests/test_api_craft/test_db_codegen.py` | Add tests for generated code with `now`/`literal` server defaults |
| Modify | `tests/test_api/test_generation_unit.py` | Update `_convert_to_input_api` test for `server_default` |

---

## Tasks

### Task 1: Add ServerDefault Literal + Update InputField

**Files:**
- Modify: `backend/src/api_craft/models/enums.py`
- Modify: `backend/src/api_craft/models/input.py:65-86`
- Modify: `backend/src/api_craft/transformers.py:100-109`
- Test: `backend/tests/test_api_craft/test_input_models.py`

- [ ] **Step 1: Write test for ServerDefault on InputField**

In `backend/tests/test_api_craft/test_input_models.py`, add:

```python
class TestServerDefaultField:
    """Tests for the server_default and default_literal fields on InputField."""

    def test_server_default_accepts_valid_strategies(self):
        for strategy in ("uuid4", "now", "now_on_update", "auto_increment", "literal"):
            field = InputField(name="test_field", type="str", server_default=strategy)
            assert field.server_default == strategy

    def test_server_default_defaults_to_none(self):
        field = InputField(name="test_field", type="str")
        assert field.server_default is None

    def test_default_literal_stored(self):
        field = InputField(
            name="status", type="str",
            server_default="literal", default_literal="active"
        )
        assert field.default_literal == "active"

    def test_no_default_value_field(self):
        """default_value was removed — verify it's not stored."""
        field = InputField(name="test_field", type="str")
        assert "default_value" not in field.model_fields
```

Add `import pytest` at the top if not already present, and add `InputField` to the existing import from `api_craft.models.input`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_input_models.py::TestServerDefaultField -v
```

Expected: FAIL — `InputField` has no `server_default` field, and still has `default_value`.

- [ ] **Step 3: Add ServerDefault Literal to enums.py**

In `backend/src/api_craft/models/enums.py`, add after the existing Literals:

```python
ServerDefault = Literal["uuid4", "now", "now_on_update", "auto_increment", "literal"]
```

- [ ] **Step 4: Update InputField in input.py**

Replace the `InputField` class (lines 65-86) with:

```python
class InputField(BaseModel):
    """Field definition for an input object.

    :ivar type: Declared field type, supporting primitive values and object references.
    :ivar name: Field identifier within the object.
    :ivar optional: Whether this field is optional (default False = required).
    :ivar description: Human-readable description of the field.
    :ivar server_default: Server default strategy for this field.
    :ivar default_literal: Literal value when server_default is 'literal'.
    :ivar validators: List of validators applied to this field.
    :ivar field_validators: List of resolved field validators with rendered code.
    """

    type: str
    name: SnakeCaseName
    optional: bool = False
    description: str | None = None
    server_default: ServerDefault | None = None
    default_literal: str | None = None
    validators: list[InputValidator] = Field(default_factory=list)
    field_validators: list[InputResolvedFieldValidator] = Field(default_factory=list)
    pk: bool = False
    appears: FieldAppearance = "both"
```

Add `ServerDefault` to the import from `api_craft.models.enums` at the top of the file.

- [ ] **Step 5: Remove default_value pass-through from transformers.py**

In `backend/src/api_craft/transformers.py`, update the `transform_field()` function (lines 87-109). Remove the `default_value=input_field.default_value` line from the `TemplateField(...)` constructor call. The return statement should be:

```python
    return TemplateField(
        type=input_field.type,
        name=input_field.name,
        optional=force_optional or input_field.optional,
        description=input_field.description,
        validators=validators,
        field_validators=field_validators,
        pk=input_field.pk,
    )
```

- [ ] **Step 6: Run tests**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_input_models.py::TestServerDefaultField -v
```

Expected: PASS

- [ ] **Step 7: Run full codegen test suite to check for regressions**

```bash
cd backend && make test-codegen
```

Expected: PASS — `default_value` was dead code, no existing tests depend on it.

- [ ] **Step 8: Commit**

```
feat(generation): add ServerDefault Literal and update InputField

Replace dead default_value field with server_default + default_literal
on InputField. Remove default_value pass-through from transformers.
```

---

### Task 2: Server Default Validation

**Files:**
- Modify: `backend/src/api_craft/models/validators.py`
- Modify: `backend/src/api_craft/models/input.py:259-274`
- Test: `backend/tests/test_api_craft/test_input_models.py`

- [ ] **Step 1: Write validation tests**

In `backend/tests/test_api_craft/test_input_models.py`, add a new test class. These tests need `InputAPI` and `InputEndpoint` to trigger model-level validation, since `validate_server_defaults` runs inside `InputAPI._validate_references`.

```python
class TestServerDefaultValidation:
    """Tests for validate_server_defaults() triggered via InputAPI construction."""

    def _make_api(self, fields, db_enabled=True):
        """Helper: build an InputAPI with one object and one GET endpoint."""
        return InputAPI(
            name="TestApi",
            objects=[InputModel(name="Thing", fields=fields)],
            endpoints=[
                InputEndpoint(
                    name="GetThings",
                    path="/things",
                    method="GET",
                    response="Thing",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=db_enabled),
            ),
        )

    # --- Rule: response + required + non-PK + db enabled → server_default required ---

    def test_response_required_no_default_raises(self):
        with pytest.raises(ValueError, match="server_default"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(name="created_at", type="datetime", appears="response"),
            ])

    def test_response_required_with_default_passes(self):
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="created_at", type="datetime",
                appears="response", server_default="now",
            ),
        ])
        assert api is not None

    def test_response_optional_no_default_passes(self):
        """Optional response-only fields don't need a server_default."""
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="deleted_at", type="datetime",
                appears="response", optional=True,
            ),
        ])
        assert api is not None

    def test_pk_field_exempt(self):
        """PK fields are exempt from the server_default rule."""
        api = self._make_api(fields=[
            InputField(name="id", type="uuid", pk=True, appears="response"),
        ])
        assert api is not None

    def test_database_disabled_skips_validation(self):
        """When database.enabled is False, no validation needed."""
        api = self._make_api(
            fields=[
                InputField(name="created_at", type="datetime", appears="response"),
            ],
            db_enabled=False,
        )
        assert api is not None

    def test_both_appears_no_validation(self):
        """Fields with appears='both' don't trigger the rule."""
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(name="name", type="str"),
        ])
        assert api is not None

    # --- Type compatibility ---

    def test_uuid4_valid_for_uuid(self):
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="ref_id", type="uuid",
                appears="response", server_default="uuid4",
            ),
        ])
        assert api is not None

    def test_uuid4_invalid_for_str(self):
        with pytest.raises(ValueError, match="not valid for type"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="name", type="str",
                    appears="response", server_default="uuid4",
                ),
            ])

    def test_now_valid_for_datetime(self):
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="created_at", type="datetime",
                appears="response", server_default="now",
            ),
        ])
        assert api is not None

    def test_now_on_update_valid_for_datetime(self):
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="updated_at", type="datetime",
                appears="response", server_default="now_on_update",
            ),
        ])
        assert api is not None

    def test_now_invalid_for_int(self):
        with pytest.raises(ValueError, match="not valid for type"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="count", type="int",
                    appears="response", server_default="now",
                ),
            ])

    def test_auto_increment_valid_for_int(self):
        api = self._make_api(fields=[
            InputField(name="id", type="uuid", pk=True),
            InputField(
                name="seq", type="int",
                appears="response", server_default="auto_increment",
            ),
        ])
        assert api is not None

    def test_auto_increment_invalid_for_str(self):
        with pytest.raises(ValueError, match="not valid for type"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="name", type="str",
                    appears="response", server_default="auto_increment",
                ),
            ])

    def test_literal_valid_for_str(self):
        api = self._make_api(fields=[
            InputField(name="id", type="int", pk=True),
            InputField(
                name="status", type="str",
                appears="response", server_default="literal",
                default_literal="active",
            ),
        ])
        assert api is not None

    def test_literal_requires_default_literal(self):
        with pytest.raises(ValueError, match="default_literal"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="status", type="str",
                    appears="response", server_default="literal",
                ),
            ])

    def test_server_default_on_both_field_validates_type_compat(self):
        """Even non-response fields with server_default get type-checked."""
        with pytest.raises(ValueError, match="not valid for type"):
            self._make_api(fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="name", type="str",
                    server_default="now",
                ),
            ])
```

Make sure the imports at the top of the file include `InputApiConfig`, `InputDatabaseConfig`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_input_models.py::TestServerDefaultValidation -v
```

Expected: FAIL — `validate_server_defaults` doesn't exist yet.

- [ ] **Step 3: Implement validate_server_defaults in validators.py**

In `backend/src/api_craft/models/validators.py`, add after the existing `validate_database_config` function (after line 269):

```python
# Type sets for server_default compatibility
SERVER_DEFAULT_VALID_TYPES: dict[str, set[str]] = {
    "uuid4": {"uuid", "UUID"},
    "now": {"datetime", "date"},
    "now_on_update": {"datetime", "date"},
    "auto_increment": {"int"},
    "literal": {"str", "bool", "int", "float", "decimal", "EmailStr", "HttpUrl"},
}


def validate_server_defaults(
    config: "InputApiConfig",
    objects: Iterable["InputModel"],
) -> None:
    """Validate server_default constraints on fields.

    Two rules:
    1. Response-only required non-PK fields must have a server_default
       when database generation is enabled.
    2. server_default strategy must be compatible with the field's type.
    3. Literal strategy requires a default_literal value.

    :param config: API configuration containing database settings.
    :param objects: Collection of declared objects.
    :raises ValueError: If any constraint is violated.
    """
    for obj in objects:
        for field in obj.fields:
            if field.pk:
                continue

            # Rule 1: response + required + non-PK + db enabled → server_default required
            if (
                config.database.enabled
                and field.appears == "response"
                and not field.optional
                and field.server_default is None
            ):
                raise ValueError(
                    f"Field '{obj.name}.{field.name}' is response-only and required "
                    f"but has no server_default. Set a server default strategy "
                    f"or make the field optional."
                )

            # Rule 2: type compatibility
            if field.server_default is not None:
                base_type = (
                    field.type.split(".")[0] if "." in field.type else field.type
                )
                valid_types = SERVER_DEFAULT_VALID_TYPES.get(
                    field.server_default, set()
                )
                if base_type not in valid_types:
                    raise ValueError(
                        f"Field '{obj.name}.{field.name}': server_default "
                        f"'{field.server_default}' is not valid for type "
                        f"'{field.type}'. Valid types: "
                        f"{', '.join(sorted(valid_types))}"
                    )

                # Rule 3: literal requires default_literal
                if (
                    field.server_default == "literal"
                    and not field.default_literal
                ):
                    raise ValueError(
                        f"Field '{obj.name}.{field.name}': server_default "
                        f"'literal' requires a default_literal value."
                    )
```

- [ ] **Step 4: Wire validation into InputAPI**

In `backend/src/api_craft/models/input.py`, add `validate_server_defaults` to the import from `api_craft.models.validators` (line 14-25).

Then add the call inside `_validate_references` (after `validate_database_config` on line 272):

```python
        validate_server_defaults(self.config, self.objects)
```

- [ ] **Step 5: Run tests**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_input_models.py::TestServerDefaultValidation -v
```

Expected: PASS

- [ ] **Step 6: Run full codegen test suite**

```bash
cd backend && make test-codegen
```

Expected: PASS — existing tests don't trigger the new validation rule (they either don't use response-only fields, or have database disabled).

- [ ] **Step 7: Commit**

```
feat(generation): add server default validation rules

Enforce that response-only required non-PK fields have a server_default
when database generation is enabled. Validate type compatibility and
require default_literal for the literal strategy.
```

---

### Task 3: Update Template Models + ORM Builder + Mako Templates

This task changes the template layer and ORM builder together because they're tightly coupled — changing `TemplateORMField` breaks `orm_builder.py` and Mako templates simultaneously.

**Files:**
- Modify: `backend/src/api_craft/models/template.py:33-44,114-125`
- Modify: `backend/src/api_craft/orm_builder.py:113-135`
- Modify: `backend/src/api_craft/templates/orm_models.mako:7-26,59-75`
- Modify: `backend/src/api_craft/templates/initial_migration.mako:27-33`
- Test: `backend/tests/test_api_craft/test_transformers.py`
- Test: `backend/tests/test_api_craft/test_db_codegen.py`

- [ ] **Step 1: Write new ORM builder tests for server_default strategies**

In `backend/tests/test_api_craft/test_transformers.py`, add a new test class. Add `ServerDefault` import if needed.

```python
class TestOrmBuilderServerDefaults:
    """Tests for server_default propagation through transform_orm_models."""

    def test_uuid_pk_sets_uuid4_server_default(self):
        model = InputModel(
            name="Thing",
            fields=[InputField(name="id", type="uuid", pk=True)],
        )
        orm_models = transform_orm_models([model])
        id_field = orm_models[0].fields[0]
        assert id_field.server_default == "uuid4"
        assert id_field.on_update is None

    def test_int_pk_sets_auto_increment_server_default(self):
        model = InputModel(
            name="Thing",
            fields=[InputField(name="id", type="int", pk=True)],
        )
        orm_models = transform_orm_models([model])
        id_field = orm_models[0].fields[0]
        assert id_field.server_default == "auto_increment"
        assert id_field.on_update is None

    def test_now_server_default(self):
        model = InputModel(
            name="Thing",
            fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="created_at", type="datetime",
                    appears="response", server_default="now",
                ),
            ],
        )
        orm_models = transform_orm_models([model])
        created_field = orm_models[0].fields[1]
        assert created_field.server_default == "now"
        assert created_field.on_update is None

    def test_now_on_update_splits_into_server_default_and_on_update(self):
        model = InputModel(
            name="Thing",
            fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="updated_at", type="datetime",
                    appears="response", server_default="now_on_update",
                ),
            ],
        )
        orm_models = transform_orm_models([model])
        updated_field = orm_models[0].fields[1]
        assert updated_field.server_default == "now"
        assert updated_field.on_update == "now"

    def test_literal_server_default(self):
        model = InputModel(
            name="Thing",
            fields=[
                InputField(name="id", type="int", pk=True),
                InputField(
                    name="status", type="str",
                    appears="response", server_default="literal",
                    default_literal="active",
                ),
            ],
        )
        orm_models = transform_orm_models([model])
        status_field = orm_models[0].fields[1]
        assert status_field.server_default == "literal"
        assert status_field.default_literal == "active"

    def test_auto_increment_non_pk(self):
        model = InputModel(
            name="Thing",
            fields=[
                InputField(name="id", type="uuid", pk=True),
                InputField(
                    name="seq", type="int",
                    appears="response", server_default="auto_increment",
                ),
            ],
        )
        orm_models = transform_orm_models([model])
        seq_field = orm_models[0].fields[1]
        assert seq_field.server_default == "auto_increment"

    def test_no_server_default_for_regular_field(self):
        model = InputModel(
            name="Thing",
            fields=[
                InputField(name="id", type="int", pk=True),
                InputField(name="name", type="str"),
            ],
        )
        orm_models = transform_orm_models([model])
        name_field = orm_models[0].fields[1]
        assert name_field.server_default is None
        assert name_field.on_update is None
        assert name_field.default_literal is None
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_transformers.py::TestOrmBuilderServerDefaults -v
```

Expected: FAIL — `TemplateORMField` has no `server_default` field.

- [ ] **Step 3: Update TemplateField — remove default_value**

In `backend/src/api_craft/models/template.py`, update `TemplateField` (lines 33-44). Remove the `default_value` field:

```python
class TemplateField(BaseModel):
    """Field definition for template rendering."""

    type: str
    name: str
    optional: bool
    description: str | None = None
    validators: list[TemplateValidator] = []
    field_validators: list[TemplateResolvedFieldValidator] = []
    pk: bool = False
```

- [ ] **Step 4: Update TemplateORMField — replace autoincrement/uuid_default**

In `backend/src/api_craft/models/template.py`, replace `TemplateORMField` (lines 114-125):

```python
class TemplateORMField(BaseModel):
    """ORM field definition for template rendering."""

    name: str
    python_type: str
    column_type: str
    primary_key: bool = False
    nullable: bool = False
    server_default: str | None = None
    on_update: str | None = None
    default_literal: str | None = None
    foreign_key: str | None = None
```

- [ ] **Step 5: Update orm_builder.py — generic server_default mapping**

In `backend/src/api_craft/orm_builder.py`, replace the field-building loop (lines 113-135) inside `transform_orm_models()`:

```python
        for field in model.fields:
            column_type = map_column_type(field.type, field.validators)
            if column_type is None:
                continue

            base_type = field.type.split(".")[0] if "." in field.type else field.type
            orm_type = ORM_PYTHON_TYPE_MAP.get(field.type) or ORM_PYTHON_TYPE_MAP.get(
                base_type, base_type
            )
            python_type = orm_type if not field.optional else f"{orm_type} | None"

            # Determine server_default strategy
            sd = None
            on_update = None
            default_literal = None

            if field.pk:
                # PK auto-gen: infer from type
                if base_type in ("uuid", "UUID"):
                    sd = "uuid4"
                elif base_type in ("int",):
                    sd = "auto_increment"
            elif field.server_default:
                if field.server_default == "now_on_update":
                    sd = "now"
                    on_update = "now"
                else:
                    sd = field.server_default
                default_literal = field.default_literal

            # SQL-quote string literals so the DDL emits DEFAULT 'value' not DEFAULT value
            if sd == "literal" and default_literal and base_type in (
                "str", "EmailStr", "HttpUrl",
            ):
                default_literal = f"'{default_literal}'"

            orm_fields.append(
                TemplateORMField(
                    name=str(field.name),
                    python_type=python_type,
                    column_type=column_type,
                    primary_key=field.pk,
                    nullable=field.optional,
                    server_default=sd,
                    on_update=on_update,
                    default_literal=default_literal,
                )
            )
```

- [ ] **Step 6: Update orm_models.mako template**

Replace `backend/src/api_craft/templates/orm_models.mako`. The header block (lines 7-26) needs a `func` import check, and the field rendering block (lines 59-75) uses the new field names.

Update the header `<%...%>` block — add after `has_assoc_tables` (line 14):

```mako
needs_func = any(
    f.server_default == "now" or f.on_update == "now"
    for m in orm_models for f in m.fields
)
```

And add to the `extra_sa` block (after line 20):

```mako
if needs_func:
    extra_sa.add("func")
```

Replace the field rendering block (lines 60-73):

```mako
<%
    parts = []
    parts.append(field.column_type)
    if field.foreign_key:
        parts.append(f'ForeignKey("{field.foreign_key}")')
    if field.primary_key:
        parts.append("primary_key=True")
    if field.server_default == "auto_increment":
        parts.append("autoincrement=True")
    elif field.server_default == "uuid4":
        parts.append("default=uuid.uuid4")
    elif field.server_default == "now":
        parts.append("server_default=func.now()")
    elif field.server_default == "literal":
        parts.append(f'server_default="{field.default_literal}"')
    if field.on_update == "now":
        parts.append("onupdate=func.now()")
    if field.nullable and not field.primary_key:
        parts.append("nullable=True")
%>\
```

- [ ] **Step 7: Update initial_migration.mako template**

In `backend/src/api_craft/templates/initial_migration.mako`, replace the column rendering block (lines 28-32):

```mako
<%
    col_type = field.column_type
    sa_type = f"sa.{col_type}" if "(" in col_type else f"sa.{col_type}()"
    extras = ""
    if field.server_default == "auto_increment":
        extras += ", autoincrement=True"
    elif field.server_default == "now":
        extras += ", server_default=sa.func.now()"
    elif field.server_default == "literal":
        extras += f', server_default="{field.default_literal}"'
    if field.foreign_key:
        extras += f', sa.ForeignKey("{field.foreign_key}")'
%>\
        sa.Column("${field.name}", ${sa_type}${extras}, nullable=${"True" if field.nullable and not field.primary_key else "False"}),
```

Note: `uuid4` has no DDL representation (Python-side default only), so it's intentionally omitted from migration output.

- [ ] **Step 8: Update existing tests in test_transformers.py and test_input_models.py**

Find tests that assert `autoincrement` or `uuid_default` on `TemplateORMField` and update them. Look for patterns like:

```python
# Old:
assert field.autoincrement is True
assert field.uuid_default is True

# New:
assert field.server_default == "auto_increment"
assert field.server_default == "uuid4"
```

Also update any direct `TemplateORMField(...)` construction in tests — remove `autoincrement`/`uuid_default` kwargs and use `server_default` instead.

**Critical: `test_input_models.py` also constructs `TemplateORMField` directly.** Update `TestTemplateORMModels::test_orm_field_creation` (line 87-93) — change `autoincrement=True` to `server_default="auto_increment"`:

```python
    def test_orm_field_creation(self):
        field = TemplateORMField(
            name="id",
            python_type="int",
            column_type="Integer",
            primary_key=True,
            server_default="auto_increment",
        )
        assert field.primary_key is True
        assert field.nullable is False
```

**Note on E2E tests:** `test_e2e_shop_full.py` asserts `"autoincrement=True" in content` and `"default=uuid.uuid4" in content`. These tests still pass without changes because the generated ORM output is identical — the Mako template renders the same strings from the new `server_default` field values.

- [ ] **Step 9: Run all ORM builder tests**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_transformers.py -v
```

Expected: PASS

- [ ] **Step 10: Write codegen tests for server default rendering**

In `backend/tests/test_api_craft/test_db_codegen.py`, add tests that verify the generated ORM and migration code for each strategy. Use the existing test patterns in that file (they generate a full API and inspect the output files).

Add a test class or individual tests:

```python
class TestServerDefaultCodegen:
    """Tests for generated code with server_default strategies."""

    def test_now_renders_func_now_in_orm(self, tmp_path):
        """server_default='now' → server_default=func.now() in ORM model."""
        api = InputAPI(
            name="TestApi",
            objects=[
                InputModel(
                    name="Event",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(
                            name="created_at", type="datetime",
                            appears="response", server_default="now",
                        ),
                    ],
                )
            ],
            endpoints=[
                InputEndpoint(
                    name="GetEvents", path="/events",
                    method="GET", response="Event",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=True),
            ),
        )
        template = transform_api(api)
        # Find ORM model content
        orm_content = render_orm_models(template)
        assert "server_default=func.now()" in orm_content
        assert "from sqlalchemy import" in orm_content
        assert "func" in orm_content  # func must be imported

    def test_now_on_update_renders_onupdate(self, tmp_path):
        """server_default='now_on_update' → server_default + onupdate in ORM."""
        api = InputAPI(
            name="TestApi",
            objects=[
                InputModel(
                    name="Event",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(
                            name="updated_at", type="datetime",
                            appears="response", server_default="now_on_update",
                        ),
                    ],
                )
            ],
            endpoints=[
                InputEndpoint(
                    name="GetEvents", path="/events",
                    method="GET", response="Event",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=True),
            ),
        )
        template = transform_api(api)
        orm_content = render_orm_models(template)
        assert "server_default=func.now()" in orm_content
        assert "onupdate=func.now()" in orm_content

    def test_literal_renders_server_default_string(self, tmp_path):
        """server_default='literal' → server_default="value" in ORM."""
        api = InputAPI(
            name="TestApi",
            objects=[
                InputModel(
                    name="Task",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(
                            name="status", type="str",
                            appears="response", server_default="literal",
                            default_literal="active",
                        ),
                    ],
                )
            ],
            endpoints=[
                InputEndpoint(
                    name="GetTasks", path="/tasks",
                    method="GET", response="Task",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=True),
            ),
        )
        template = transform_api(api)
        orm_content = render_orm_models(template)
        assert "server_default=\"'active'\"" in orm_content

    def test_now_renders_in_migration(self, tmp_path):
        """server_default='now' → server_default=sa.func.now() in migration."""
        api = InputAPI(
            name="TestApi",
            objects=[
                InputModel(
                    name="Event",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(
                            name="created_at", type="datetime",
                            appears="response", server_default="now",
                        ),
                    ],
                )
            ],
            endpoints=[
                InputEndpoint(
                    name="GetEvents", path="/events",
                    method="GET", response="Event",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=True),
            ),
        )
        template = transform_api(api)
        migration_content = render_initial_migration(template)
        assert "server_default=sa.func.now()" in migration_content

    def test_literal_renders_in_migration(self, tmp_path):
        """server_default='literal' → server_default="value" in migration."""
        api = InputAPI(
            name="TestApi",
            objects=[
                InputModel(
                    name="Task",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(
                            name="status", type="str",
                            appears="response", server_default="literal",
                            default_literal="active",
                        ),
                    ],
                )
            ],
            endpoints=[
                InputEndpoint(
                    name="GetTasks", path="/tasks",
                    method="GET", response="Task",
                )
            ],
            config=InputApiConfig(
                database=InputDatabaseConfig(enabled=True),
            ),
        )
        template = transform_api(api)
        migration_content = render_initial_migration(template)
        assert "server_default=\"'active'\"" in migration_content
```

**Important:** Follow the existing `test_db_codegen.py` pattern — use `APIGenerator().generate(api_input, path=str(tmp_path))` to generate files to a temp directory, then read and inspect the output files. Do NOT call individual render functions. Example from existing tests:

```python
def _generate_and_read(self, api_input, tmp_path, filename):
    """Generate API and read a specific output file."""
    APIGenerator().generate(api_input, path=str(tmp_path))
    from api_craft.utils import camel_to_kebab
    project_dir = tmp_path / camel_to_kebab(api_input.name)
    return (project_dir / "src" / filename).read_text()
```

Use this pattern for all codegen rendering tests. Also add a `now_on_update` migration test to verify migration output contains `server_default=sa.func.now()` but does NOT contain `onupdate` (since `onupdate` is ORM-level only, not DDL).

- [ ] **Step 11: Run codegen tests**

```bash
cd backend && poetry run pytest tests/test_api_craft/test_db_codegen.py -v
```

Expected: PASS

- [ ] **Step 12: Run full codegen test suite**

```bash
cd backend && make test-codegen
```

Expected: PASS

- [ ] **Step 13: Commit**

```
feat(generation): render server default strategies in ORM and migration templates

Replace autoincrement/uuid_default booleans on TemplateORMField with
generic server_default/on_update/default_literal fields. Update
orm_builder to map InputField.server_default to TemplateORMField.
Update Mako templates to render all five strategies.
```

---

### Task 4: REST API — Database Model + Migration

**Files:**
- Modify: `backend/src/api/models/database.py:457-498`
- Modify: `backend/src/api/migrations/versions/4141ad7f2255_initial_schema.py:310-334`

- [ ] **Step 1: Add columns to ObjectFieldAssociation**

In `backend/src/api/models/database.py`, add to `ObjectFieldAssociation` class (after `appears` on line 491):

```python
    server_default: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_literal: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Update the `__table_args__` (lines 469-474) to add a CHECK constraint:

```python
    __table_args__ = (
        CheckConstraint(
            "appears IN ('both', 'request', 'response')",
            name="ck_fields_on_objects_appears",
        ),
        CheckConstraint(
            "server_default IS NULL OR server_default IN "
            "('uuid4', 'now', 'now_on_update', 'auto_increment', 'literal')",
            name="ck_fields_on_objects_server_default",
        ),
    )
```

- [ ] **Step 2: Update initial migration**

In `backend/src/api/migrations/versions/4141ad7f2255_initial_schema.py`, update the `fields_on_objects` table creation (after the `appears` column on line 326).

Add these columns before the constraints:

```python
        sa.Column("server_default", sa.Text(), nullable=True),
        sa.Column("default_literal", sa.Text(), nullable=True),
```

Add the CHECK constraint alongside the existing `appears` constraint (after line 333):

```python
        sa.CheckConstraint(
            "server_default IS NULL OR server_default IN "
            "('uuid4', 'now', 'now_on_update', 'auto_increment', 'literal')",
            name="ck_fields_on_objects_server_default",
        ),
```

- [ ] **Step 3: Commit**

```
feat(models): add server_default columns to ObjectFieldAssociation

Add server_default and default_literal columns to the fields_on_objects
table with a CHECK constraint restricting server_default to valid
strategy values.
```

---

### Task 5: REST API — Schemas + Generation Service

**Files:**
- Modify: `backend/src/api/schemas/literals.py`
- Modify: `backend/src/api/schemas/object.py:13-30`
- Modify: `backend/src/api/services/generation.py:204-219`
- Test: `backend/tests/test_api/test_generation_unit.py`

- [ ] **Step 1: Re-export ServerDefault in literals.py**

In `backend/src/api/schemas/literals.py`, add `ServerDefault` to the import list:

```python
from api_craft.models.enums import (  # noqa: F401
    Cardinality,
    Container,
    FieldAppearance,
    HttpMethod,
    OnDeleteAction,
    ResponseShape,
    ServerDefault,
    ValidatorMode,
    check_constraint_sql,
)
```

- [ ] **Step 2: Update ObjectFieldReferenceSchema**

In `backend/src/api/schemas/object.py`, add the import for `ServerDefault`:

```python
from api.schemas.literals import FieldAppearance, ServerDefault
```

Add fields to `ObjectFieldReferenceSchema` (after `appears` on line 27):

```python
    server_default: ServerDefault | None = Field(default=None, alias="serverDefault")
    default_literal: str | None = Field(default=None, alias="defaultLiteral")
```

- [ ] **Step 3: Update generation service**

In `backend/src/api/services/generation.py`, update the `InputField` construction (lines 204-219). Replace `default_value=field.default_value` with:

```python
                input_field = InputField(
                    name=field.name,
                    type=_build_field_type(
                        field.field_type.python_type, field.container
                    ),
                    optional=assoc.optional,
                    description=field.description,
                    server_default=assoc.server_default,
                    default_literal=assoc.default_literal,
                    validators=_build_field_validators(field),
                    field_validators=[
                        InputResolvedFieldValidator(**rv)
                        for rv in _build_resolved_field_validators(field)
                    ],
                    pk=assoc.is_pk,
                    appears=assoc.appears,
                )
```

- [ ] **Step 4: Update generation unit tests**

In `backend/tests/test_api/test_generation_unit.py`, update all mock objects that set `field.default_value = None` (lines 142 and 226). The generation service no longer reads `field.default_value` — it reads `assoc.server_default` and `assoc.default_literal` instead. MagicMock will auto-create these as MagicMock objects (not None), which will fail Pydantic validation.

**For every `assoc` mock object**, add explicit attributes:

```python
        assoc.server_default = None
        assoc.default_literal = None
```

Add these lines after `assoc.appears = "both"` in both `test_database_enabled_passed_through` (line 146-151) and `_make_api_with_objects` (line 231-236).

The `field.default_value = None` lines (142, 226) can be removed since the generation service no longer reads that field, but leaving them is harmless.

- [ ] **Step 5: Run REST API tests**

```bash
cd backend && make test
```

Expected: PASS

- [ ] **Step 6: Commit**

```
feat(api): expose server_default in object schemas and generation service

Add serverDefault and defaultLiteral to ObjectFieldReferenceSchema.
Update generation service to pass server_default from the association
to InputField instead of the dead default_value.
```

---

### Task 6: Full Test Suite

- [ ] **Step 1: Run codegen tests**

```bash
cd backend && make test-codegen
```

Expected: PASS

- [ ] **Step 2: Run unit/integration tests**

```bash
cd backend && make test
```

Expected: PASS

- [ ] **Step 3: Run E2E tests**

```bash
cd backend && make test-e2e
```

Expected: PASS

- [ ] **Step 4: Format**

```bash
cd backend && poetry run black src/ tests/
```

- [ ] **Step 5: Commit formatting if needed**

```
style(api): format with black
```
