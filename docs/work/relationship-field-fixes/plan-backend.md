# Backend Plan: Relationship Field Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

## Goal

Fix four issues in the code generation pipeline so that relationship FK fields work correctly end-to-end: proper Pydantic serialization, FK IDs in all schema variants, and correct FK type derivation.

## Architecture

The code generation pipeline flows: `InputModel` → `schema_splitter.py` (derives Create/Update/Response schemas) → `prepare.py` (computes imports, passes to templates) → `models.mako` (renders Pydantic classes). Changes touch `schema_splitter.py` (FK in Create/Update + type derivation), `prepare.py` (ConfigDict import), and `models.mako` (ConfigDict on Response models).

## Tech Stack

Python 3.13+, FastAPI, SQLAlchemy, Pydantic v2, pytest.

## Prerequisite

None — backend goes first.

---

## Part 1: Add `ConfigDict(from_attributes=True)` to Response Schemas

### Task 1.1: Add ConfigDict to Pydantic imports in `prepare.py`

**Files:** `src/api_craft/prepare.py`

**Steps:**

1. Open `src/api_craft/prepare.py`, function `_compute_pydantic_imports` (~line 239).

2. The function currently computes imports as `["BaseModel"]` plus optional `Field`, `field_validator`, `model_validator`. It needs to also include `ConfigDict` when any model name ends with `Response` (i.e., when schema splitting produced Response models that need `from_attributes=True`).

3. Add a check for whether any model name ends with `"Response"` and add `ConfigDict` to imports:

**Before** (~line 249):
```python
    imports = ["BaseModel"]
```

**After:**
```python
    has_response_model = any(
        str(model.name).endswith("Response") for model in models
    )

    imports = ["BaseModel"]
    if has_response_model:
        imports.append("ConfigDict")
```

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `fix(generation): add ConfigDict to pydantic imports for Response schemas`

### Task 1.2: Render `model_config` in Response models in `models.mako`

**Files:** `src/api_craft/templates/models.mako`

**Steps:**

1. Open `src/api_craft/templates/models.mako`. Currently line 16-18:
```mako
class ${model.name}(BaseModel):
%     for field in model.fields:
    ${render_field(field)}
```

2. Add a `model_config` line for Response models, right after the class declaration and before the fields:

**Replace** the class block (lines 16-19) with:
```mako
class ${model.name}(BaseModel):
%     if str(model.name).endswith('Response'):
    model_config = ConfigDict(from_attributes=True)

%     endif
%     for field in model.fields:
    ${render_field(field)}
```

3. Verify the generated output includes `model_config = ConfigDict(from_attributes=True)` only on Response models.

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `fix(generation): render model_config with from_attributes on Response schemas`

### Task 1.3: Add test for ConfigDict in generated output

**Files:** `tests/test_api_craft/test_codegen_relationships.py`

**Steps:**

1. Add a new test to class `TestRelationshipCodeGeneration` (~line 415):

```python
    def test_response_schema_has_config_dict(self, rel_project: Path):
        content = (rel_project / "src" / "models.py").read_text()
        assert "ConfigDict" in content
        assert "from_attributes=True" in content
```

2. Also add a test that verifies Create schemas do NOT have ConfigDict:

```python
    def test_create_schema_no_config_dict(self, rel_project: Path):
        content = (rel_project / "src" / "models.py").read_text()
        # ConfigDict should only appear on Response models
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if "Create(BaseModel)" in line:
                # Next few lines should NOT have model_config
                block = "\n".join(lines[i:i+5])
                assert "model_config" not in block
```

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `test(generation): add ConfigDict verification tests`

---

## Part 2: Add FK ID to Create and Update Schemas

### Task 2.1: Add FK ID fields to Create and Update schemas in `schema_splitter.py`

**Files:** `src/api_craft/schema_splitter.py`

**Steps:**

1. Open `src/api_craft/schema_splitter.py`. Currently the FK ID addition loop (lines 32-45) only adds to `response_fields`. We need to also add to `create_fields` and `update_fields`.

2. **Before** the existing FK loop (line 32), add similar loops for create and update:

**Replace** the entire FK section (lines 32-45) with:

```python
    # Add FK ID fields for `references` relationships
    for rel in input_model.relationships:
        if rel.cardinality == "references":
            fk_name = f"{rel.name}_id"

            # Determine FK type from target model's PK
            fk_type = _resolve_fk_type(fk_name, rel.target_model, input_model)

            # Add to Create (required)
            existing_create = {str(f.name) for f in create_fields}
            if fk_name not in existing_create:
                create_fields.append(
                    InputField(
                        type=fk_type,
                        name=fk_name,
                        nullable=False,
                        description=f"FK reference to {rel.target_model}",
                    )
                )

            # Add to Update (nullable — optional on partial update)
            existing_update = {str(f.name) for f in update_fields}
            if fk_name not in existing_update:
                update_fields.append(
                    InputField(
                        type=fk_type,
                        name=fk_name,
                        nullable=True,
                        description=f"FK reference to {rel.target_model}",
                    )
                )

            # Add to Response
            existing_response = {str(f.name) for f in response_fields}
            if fk_name not in existing_response:
                response_fields.append(
                    InputField(
                        type=fk_type,
                        name=fk_name,
                        nullable=False,
                        description=f"FK reference to {rel.target_model}",
                    )
                )
```

**Note:** The `_resolve_fk_type` helper is created in Task 3.1. For now, you can inline `fk_type = "uuid"` and fix it in Part 3. Or implement Part 3 first — either order works since we're committing after each task.

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `fix(generation): add FK ID fields to Create and Update schemas`

### Task 2.2: Update existing test and add new tests

**Files:** `tests/test_api_craft/test_codegen_relationships.py`

**Steps:**

1. **Invert** the existing test `test_references_fk_id_not_in_create_schema` (line 129). Rename it and change the assertion:

**Before:**
```python
    def test_references_fk_id_not_in_create_schema(self):
        ...
        create_names = [f.name for f in create.fields]
        assert "author_id" not in create_names
```

**After:**
```python
    def test_references_fk_id_in_create_schema(self):
        model = InputModel(
            name="Post",
            fields=[
                InputField(name="id", type="uuid", pk=True, exposure="read_only"),
                InputField(name="title", type="str"),
            ],
            relationships=[
                InputRelationship(
                    name="author",
                    target_model="User",
                    cardinality="references",
                )
            ],
        )
        schemas = split_model_schemas(model)
        create = schemas[0]  # Create schema
        create_names = [f.name for f in create.fields]
        assert "author_id" in create_names
```

2. **Add** a new test for FK in Update schema:

```python
    def test_references_fk_id_in_update_schema(self):
        model = InputModel(
            name="Post",
            fields=[
                InputField(name="id", type="uuid", pk=True, exposure="read_only"),
                InputField(name="title", type="str"),
            ],
            relationships=[
                InputRelationship(
                    name="author",
                    target_model="User",
                    cardinality="references",
                )
            ],
        )
        schemas = split_model_schemas(model)
        update = schemas[1]  # Update schema
        update_names = [f.name for f in update.fields]
        assert "author_id" in update_names
        # FK should be nullable in Update (partial update)
        fk_field = next(f for f in update.fields if str(f.name) == "author_id")
        assert fk_field.nullable is True
```

3. **Add** a test verifying FK is NOT required (nullable) in Update:

```python
    def test_references_fk_required_in_create(self):
        model = InputModel(
            name="Post",
            fields=[
                InputField(name="id", type="uuid", pk=True, exposure="read_only"),
                InputField(name="title", type="str"),
            ],
            relationships=[
                InputRelationship(
                    name="author",
                    target_model="User",
                    cardinality="references",
                )
            ],
        )
        schemas = split_model_schemas(model)
        create = schemas[0]
        fk_field = next(f for f in create.fields if str(f.name) == "author_id")
        assert fk_field.nullable is False
```

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `test(generation): update FK schema tests for Create and Update`

---

## Part 3: Derive FK Type From Target PK

### Task 3.1: Add `_resolve_fk_type` helper and pass relationships context to `split_model_schemas`

**Files:** `src/api_craft/schema_splitter.py`, `src/api_craft/prepare.py`

**Steps:**

1. The problem: `schema_splitter.py` doesn't have access to other models, so it can't look up the target model's PK type. The function `split_model_schemas` receives a single `InputModel`, but needs the full list of models to resolve FK types.

2. **Add** a module-level helper function to `schema_splitter.py` (before `split_model_schemas`):

```python
def _resolve_fk_type(
    fk_name: str,
    target_model_name: str,
    source_model: InputModel,
    all_models: list[InputModel] | None = None,
) -> str:
    """Resolve the FK field type from the target model's PK type.

    Falls back to "uuid" if the target model or its PK cannot be found.
    """
    if all_models:
        target = next(
            (m for m in all_models if str(m.name) == target_model_name), None
        )
        if target:
            pk_field = next((f for f in target.fields if f.pk), None)
            if pk_field:
                return pk_field.type
    return "uuid"
```

3. **Update** the `split_model_schemas` function signature to accept an optional `all_models` parameter:

**Before:**
```python
def split_model_schemas(input_model: InputModel) -> list[InputModel]:
```

**After:**
```python
def split_model_schemas(
    input_model: InputModel,
    all_models: list[InputModel] | None = None,
) -> list[InputModel]:
```

4. **Update** the FK loop (from Task 2.1) to call `_resolve_fk_type` with `all_models`:

```python
            fk_type = _resolve_fk_type(fk_name, rel.target_model, input_model, all_models)
```

5. **Update** the call site in `prepare.py` (~line 622) to pass all models:

**Before:**
```python
                prepared_models.extend(split_model_schemas(model))
```

**After:**
```python
                prepared_models.extend(split_model_schemas(model, input_api.objects))
```

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `fix(generation): derive FK type from target model PK instead of hardcoding uuid`

### Task 3.2: Add test for FK type derivation with integer PK

**Files:** `tests/test_api_craft/test_codegen_relationships.py`

**Steps:**

1. Add a new test class `TestFkTypeDerivedFromTargetPk`:

```python
class TestFkTypeDerivedFromTargetPk:
    """Verify FK type matches target model's PK type, not hardcoded uuid."""

    def test_fk_type_matches_int_pk(self):
        """When target has int PK, FK should be int, not uuid."""
        models = [
            _make_model(
                "Comment",
                [
                    {"name": "id", "type": "uuid", "pk": True},
                    {"name": "body", "type": "str"},
                ],
                relationships=[
                    {
                        "name": "article",
                        "target_model": "Article",
                        "cardinality": "references",
                    }
                ],
            ),
            _make_model(
                "Article",
                [
                    {"name": "id", "type": "int", "pk": True},
                    {"name": "title", "type": "str"},
                ],
            ),
        ]
        from api_craft.schema_splitter import split_model_schemas

        comment_input = models[0]
        schemas = split_model_schemas(comment_input, all_models=models)
        response = schemas[2]
        fk_field = next(f for f in response.fields if str(f.name) == "article_id")
        assert fk_field.type == "int"

    def test_fk_type_defaults_to_uuid_without_context(self):
        """When all_models is not provided, FK defaults to uuid."""
        model = InputModel(
            name="Post",
            fields=[
                InputField(name="id", type="uuid", pk=True, exposure="read_only"),
                InputField(name="title", type="str"),
            ],
            relationships=[
                InputRelationship(
                    name="author",
                    target_model="User",
                    cardinality="references",
                )
            ],
        )
        schemas = split_model_schemas(model)
        response = schemas[2]
        fk_field = next(f for f in response.fields if str(f.name) == "author_id")
        assert fk_field.type == "uuid"

    def test_fk_type_in_create_matches_target_pk(self):
        """FK type in Create schema should also match target PK."""
        models = [
            _make_model(
                "Comment",
                [
                    {"name": "id", "type": "uuid", "pk": True},
                    {"name": "body", "type": "str"},
                ],
                relationships=[
                    {
                        "name": "article",
                        "target_model": "Article",
                        "cardinality": "references",
                    }
                ],
            ),
            _make_model(
                "Article",
                [
                    {"name": "id", "type": "int", "pk": True},
                    {"name": "title", "type": "str"},
                ],
            ),
        ]
        schemas = split_model_schemas(models[0], all_models=models)
        create = schemas[0]
        fk_field = next(f for f in create.fields if str(f.name) == "article_id")
        assert fk_field.type == "int"
```

2. Add necessary imports at the top of the test file if not already present:
```python
from api_craft.schema_splitter import split_model_schemas
```
(Already imported on line 27.)

**Test:** `cd backend && poetry run pytest tests/test_api_craft/test_codegen_relationships.py -v`

**Commit:** `test(generation): add FK type derivation tests for int PK targets`

---

## Final Verification

### Task 4.1: Run full test suite

**Steps:**

1. Run unit tests: `cd backend && make test`
2. Run E2E tests: `cd backend && make test-e2e`
3. Format: `cd backend && poetry run black src/ tests/`
4. Fix any failures before completing.

**Commit:** (only if formatting changes needed) `style(generation): format with black`

---

## Expected API Contract

After these fixes, a `Post` object with a `references` relationship to `User` (uuid PK) produces:

**Create request body:**
```json
{
  "title": "string",
  "author_id": "00000000-0000-0000-0000-000000000000"
}
```

**Update request body:**
```json
{
  "title": "string",
  "author_id": "00000000-0000-0000-0000-000000000000"
}
```
(All fields nullable/optional in Update.)

**Response body:**
```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "title": "string",
  "author_id": "00000000-0000-0000-0000-000000000000"
}
```

For `has_one`, `has_many`, `many_to_many` — no fields appear in any schema. The ORM `relationship()` calls remain as navigation paths for post-generation customization.
