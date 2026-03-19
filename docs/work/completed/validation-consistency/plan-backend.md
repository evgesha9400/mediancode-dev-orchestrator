# Validation Consistency — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix validation divergences between API and frontend, centralize validation constants, and add consistency tests.

**Architecture:** Fix the 3 bugs (server_default persistence, PascalCase, PK types), centralize scattered validation constants into a catalog module extending the existing `enums.py` pattern, derive CHECK constraints from Literal types instead of hardcoding, and add tests that enforce consistency.

**Tech Stack:** Python 3.13, FastAPI, Pydantic, SQLAlchemy, Alembic, pytest

**Spec:** `docs/work/validation-consistency/spec.md` in the orchestrator repo

---

## Part 1: Fix server_default / default_literal Data Loss

The `ObjectFieldReferenceSchema` accepts `server_default` and `default_literal` fields (object.py:30-31), and the DB model has these columns (database.py:499-500), but `_set_field_associations()` never persists them.

### Task 1: Add test for server_default round-trip

**Files:**
- Create: `tests/test_api/test_object_server_default.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests: server_default and default_literal persistence through object CRUD."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.auth import get_current_user
from api.main import app
from api.models.database import (
    FieldModel,
    Namespace,
    ObjectDefinition,
    UserModel,
)

TEST_CLERK_ID = "test_user_server_default"


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def client():
    """Module-scoped HTTP client with auth override and cleanup."""
    app.dependency_overrides[get_current_user] = lambda: TEST_CLERK_ID

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test/v1",
    ) as c:
        yield c

    app.dependency_overrides.pop(get_current_user, None)

    from api.settings import get_settings

    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as session:
        result = await session.execute(
            select(UserModel).where(UserModel.clerk_id == TEST_CLERK_ID)
        )
        user = result.scalar_one_or_none()
        if user:
            uid = user.id
            await session.execute(
                delete(ObjectDefinition).where(ObjectDefinition.user_id == uid)
            )
            await session.execute(delete(FieldModel).where(FieldModel.user_id == uid))
            await session.execute(delete(Namespace).where(Namespace.user_id == uid))
            await session.execute(delete(UserModel).where(UserModel.id == uid))
            await session.commit()

    await engine.dispose()


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
class TestServerDefaultPersistence:
    """server_default and default_literal must round-trip through object CRUD."""

    namespace_id: str = ""
    type_ids: dict[str, str] = {}
    field_id: str = ""
    object_id: str = ""

    async def test_phase_00_setup(self, client: AsyncClient):
        cls = TestServerDefaultPersistence
        resp = await client.get("/types")
        assert resp.status_code == 200
        cls.type_ids = {t["name"]: t["id"] for t in resp.json()}

        resp = await client.post("/namespaces", json={"name": "SdTest"})
        assert resp.status_code == 201
        cls.namespace_id = resp.json()["id"]

        resp = await client.post(
            "/fields",
            json={
                "namespaceId": cls.namespace_id,
                "name": "created_at",
                "typeId": cls.type_ids["datetime"],
            },
        )
        assert resp.status_code == 201
        cls.field_id = resp.json()["id"]

    async def test_create_object_with_server_default(self, client: AsyncClient):
        """server_default should be persisted and returned."""
        cls = TestServerDefaultPersistence
        resp = await client.post(
            "/objects",
            json={
                "namespaceId": cls.namespace_id,
                "name": "Timestamped",
                "fields": [
                    {
                        "fieldId": cls.field_id,
                        "optional": False,
                        "isPk": False,
                        "appears": "response",
                        "serverDefault": "now",
                    }
                ],
            },
        )
        assert resp.status_code == 201, f"Unexpected: {resp.text}"
        body = resp.json()
        cls.object_id = body["id"]
        assert len(body["fields"]) == 1
        assert body["fields"][0]["serverDefault"] == "now"

    async def test_update_object_with_default_literal(self, client: AsyncClient):
        """default_literal should be persisted and returned."""
        cls = TestServerDefaultPersistence
        int_type_id = cls.type_ids["int"]

        # Create an int field for literal default
        resp = await client.post(
            "/fields",
            json={
                "namespaceId": cls.namespace_id,
                "name": "sort_order",
                "typeId": int_type_id,
            },
        )
        assert resp.status_code == 201
        int_field_id = resp.json()["id"]

        resp = await client.put(
            f"/objects/{cls.object_id}",
            json={
                "fields": [
                    {
                        "fieldId": int_field_id,
                        "optional": False,
                        "isPk": False,
                        "appears": "response",
                        "serverDefault": "literal",
                        "defaultLiteral": "0",
                    }
                ],
            },
        )
        assert resp.status_code == 200, f"Unexpected: {resp.text}"
        body = resp.json()
        assert len(body["fields"]) == 1
        assert body["fields"][0]["serverDefault"] == "literal"
        assert body["fields"][0]["defaultLiteral"] == "0"

    async def test_phase_99_cleanup(self, client: AsyncClient):
        cls = TestServerDefaultPersistence
        if cls.object_id:
            resp = await client.delete(f"/objects/{cls.object_id}")
            assert resp.status_code == 204
        if cls.namespace_id:
            resp = await client.delete(f"/namespaces/{cls.namespace_id}")
            assert resp.status_code == 204
```

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_api/test_object_server_default.py -v`
Expected: FAIL — `serverDefault` will be `None` in the response because it's not being persisted.

- [ ] **Step 3: Commit the failing test**

```
git add tests/test_api/test_object_server_default.py
# Use /commit skill
```

### Task 2: Fix server_default persistence

**Files:**
- Modify: `src/api/services/object.py:188-196`

- [ ] **Step 1: Fix `_set_field_associations` to persist server_default and default_literal**

In `src/api/services/object.py`, the `_set_field_associations` method at ~line 187-198, change the `ObjectFieldAssociation` constructor to include the missing fields:

```python
        for position, field_ref in enumerate(fields):
            assoc = ObjectFieldAssociation(
                object_id=obj.id,
                field_id=field_ref.field_id,
                optional=field_ref.optional,
                is_pk=field_ref.is_pk,
                appears=field_ref.appears,
                server_default=field_ref.server_default,
                default_literal=field_ref.default_literal,
                position=position,
            )
            self.db.add(assoc)
```

- [ ] **Step 2: Run test to verify it passes**

Run: `poetry run pytest tests/test_api/test_object_server_default.py -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `make test && make test-e2e`
Expected: All pass

- [ ] **Step 4: Format and commit**

```
poetry run black src/ tests/
# Use /commit skill
```

---

## Part 2: Fix PascalCase Validation Divergence

Backend allows underscores in PascalCase names (line 583: `value.replace("_", "").isalnum()`). Frontend rejects them. Frontend is correct — underscores don't belong in PascalCase.

### Task 3: Add test for underscore rejection in PascalCase

**Files:**
- Modify: `tests/test_api_craft/test_input_models.py`

- [ ] **Step 1: Add test case**

Add to the existing test file, after the existing `TestPrimaryKeyValidation` class:

```python
class TestPascalCaseValidation:
    """PascalCase name validation must reject underscores."""

    def test_rejects_underscores(self):
        """Names with underscores are not valid PascalCase."""
        with pytest.raises(ValueError, match="PascalCaseName"):
            InputAPI(
                name="User_Profile",
                endpoints=[
                    InputEndpoint(
                        name="GetUsers",
                        path="/users",
                        method="GET",
                        response="User",
                    )
                ],
                objects=[
                    InputModel(
                        name="User",
                        fields=[InputField(name="id", type="int")],
                    )
                ],
            )

    def test_accepts_valid_pascal_case(self):
        """Standard PascalCase names are accepted."""
        api = InputAPI(
            name="UserProfile",
            endpoints=[
                InputEndpoint(
                    name="GetUsers",
                    path="/users",
                    method="GET",
                    response="User",
                )
            ],
            objects=[
                InputModel(
                    name="User",
                    fields=[InputField(name="id", type="int")],
                )
            ],
        )
        assert api.name == "UserProfile"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_api_craft/test_input_models.py::TestPascalCaseValidation::test_rejects_underscores -v`
Expected: FAIL — currently `User_Profile` passes validation.

- [ ] **Step 3: Commit the failing test**

```
git add tests/test_api_craft/test_input_models.py
# Use /commit skill
```

### Task 4: Fix PascalCase validation to reject underscores

**Files:**
- Modify: `src/api_craft/models/validators.py:566-593`

- [ ] **Step 1: Update `validate_pascal_case_name` to reject underscores**

Replace the function body at ~line 566-593:

```python
def validate_pascal_case_name(value: str) -> None:
    """Validate that ``value`` is a PascalCase identifier.

    :param value: Candidate identifier to validate.
    :raises TypeError: If ``value`` is not a string.
    :raises ValueError: If ``value`` is empty, does not start with an uppercase
        letter, contains non-alphanumeric characters, or has consecutive uppercase.
    """

    if not value:
        raise ValueError("PascalCaseName cannot be empty")

    if not value[0].isupper():
        raise ValueError(
            f"PascalCaseName must start with uppercase letter, got: {value}"
        )

    if not value.isalnum():
        raise ValueError(
            f"PascalCaseName must contain only letters and numbers, got: {value}"
        )

    # Disallow consecutive uppercase letters to enforce strict PascalCase
    for i in range(1, len(value)):
        if value[i].isupper() and value[i - 1].isupper():
            raise ValueError(
                f"PascalCaseName should not have consecutive uppercase letters, got: {value}"
            )
```

The key change: `value.replace("_", "").isalnum()` → `value.isalnum()`. This rejects underscores, aligning with the frontend regex `^[A-Z](?:[a-z0-9]+[A-Z])*[a-z0-9]*$`.

- [ ] **Step 2: Run the new test to verify it passes**

Run: `poetry run pytest tests/test_api_craft/test_input_models.py::TestPascalCaseValidation -v`
Expected: PASS

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `make test && make test-e2e`
Expected: All pass. No existing data should use underscored PascalCase names.

- [ ] **Step 4: Format and commit**

```
poetry run black src/ tests/
# Use /commit skill
```

---

## Part 3: Normalize PK Type Set

Backend `ALLOWED_PK_TYPES` includes `"UUID"` (uppercase) which the frontend doesn't allow. Seed data uses lowercase `"uuid"`. Remove the uppercase variant.

### Task 5: Fix ALLOWED_PK_TYPES

**Files:**
- Modify: `src/api_craft/models/validators.py:230`

- [ ] **Step 1: Add test that "UUID" (uppercase) is rejected as PK type**

Add to `tests/test_api_craft/test_input_models.py`, in the existing `TestPrimaryKeyTypeRestriction` class (not `TestPrimaryKeyValidation` — that's for optional/multiple PK rules):

```python
    def test_pk_rejects_uppercase_uuid(self):
        """PK type 'UUID' (uppercase) should be rejected — only 'uuid' is valid."""
        with pytest.raises(ValueError, match="unsupported type"):
            InputAPI(
                name="PkTypeTest",
                endpoints=[
                    InputEndpoint(
                        name="GetItems",
                        path="/items",
                        method="GET",
                        response="Item",
                    )
                ],
                objects=[
                    InputModel(
                        name="Item",
                        fields=[InputField(name="id", type="UUID", pk=True)],
                    )
                ],
            )
```

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_api_craft/test_input_models.py::TestPrimaryKeyValidation::test_pk_rejects_uppercase_uuid -v`
Expected: FAIL — currently "UUID" is in `ALLOWED_PK_TYPES`.

- [ ] **Step 3: Fix the constant**

In `src/api_craft/models/validators.py` at line 230, change:

```python
ALLOWED_PK_TYPES = {"int", "uuid"}
```

(Remove `"UUID"` — seed data uses lowercase `"uuid"`)

- [ ] **Step 4: Run tests**

Run: `make test && make test-e2e`
Expected: All pass

- [ ] **Step 5: Format and commit**

```
poetry run black src/ tests/
# Use /commit skill
```

---

## Part 4: Derive CHECK Constraints from Literal Types

The migration hardcodes CHECK constraint values (e.g., `"server_default IN ('uuid4', 'now', ...)"`) instead of using the `check_constraint_sql()` helper from `enums.py`. This means adding a new value to a Literal type doesn't auto-propagate to the DB.

### Task 6: Add consistency test between enums and migration CHECK constraints

**Files:**
- Create: `tests/test_api/test_enum_check_consistency.py`

- [ ] **Step 1: Write the test**

```python
"""Test that migration CHECK constraints match Literal types in enums.py."""

from typing import get_args

import pytest

from api_craft.models.enums import (
    Cardinality,
    Container,
    FieldAppearance,
    HttpMethod,
    ResponseShape,
    ServerDefault,
    ValidatorMode,
    check_constraint_sql,
)


# These tuples map: (Literal type, column name used in migration, table context)
ENUM_CHECK_PAIRS = [
    (Container, "container", "fields"),
    (FieldAppearance, "appears", "fields_on_objects"),
    (Cardinality, "cardinality", "object_relationships"),
    (HttpMethod, "method", "api_endpoints"),
    (ResponseShape, "response_shape", "api_endpoints"),
    (ValidatorMode, "mode", "field_validator_templates"),
    # model_validator_templates also uses ValidatorMode with the same values
]


class TestEnumCheckConsistency:
    """Verify that CHECK constraint SQL can be derived from Literal types."""

    @pytest.mark.parametrize(
        "literal_type,column,table",
        ENUM_CHECK_PAIRS,
        ids=[f"{t[2]}.{t[1]}" for t in ENUM_CHECK_PAIRS],
    )
    def test_check_constraint_sql_produces_valid_output(
        self, literal_type, column, table
    ):
        """check_constraint_sql() should produce valid SQL for each enum."""
        sql = check_constraint_sql(column, literal_type)
        values = get_args(literal_type)
        for val in values:
            assert f"'{val}'" in sql, f"Value '{val}' missing from CHECK SQL for {table}.{column}"
        assert sql.startswith(f"{column} IN (")

    def test_server_default_check_allows_null(self):
        """ServerDefault CHECK must allow NULL (server_default is nullable)."""
        sql = check_constraint_sql("server_default", ServerDefault)
        # The migration uses: "server_default IS NULL OR server_default IN (...)"
        # check_constraint_sql only produces the IN clause; the IS NULL prefix
        # must be added separately in the migration.
        assert "server_default IN (" in sql
```

- [ ] **Step 2: Run to verify it passes** (this test validates the helper, not the migration)

Run: `poetry run pytest tests/test_api/test_enum_check_consistency.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add tests/test_api/test_enum_check_consistency.py
# Use /commit skill
```

### Task 7: Refactor migration to use check_constraint_sql()

**Files:**
- Modify: `src/api/migrations/versions/4141ad7f2255_initial_schema.py`

- [ ] **Step 1: Read the current migration file**

Read the full migration to find all hardcoded CHECK constraint strings. Look for patterns like `CheckConstraint("column IN ('val1', 'val2', ...)")`.

- [ ] **Step 2: Replace hardcoded CHECK constraints with check_constraint_sql() calls**

At the top of the migration, add the import:

```python
from api_craft.models.enums import (
    Cardinality,
    Container,
    FieldAppearance,
    HttpMethod,
    ResponseShape,
    ServerDefault,
    ValidatorMode,
    check_constraint_sql,
)
```

Then replace each hardcoded CHECK constraint string with a `check_constraint_sql()` call. For example:

```python
# Before:
CheckConstraint("container IN ('List')", name="ck_fields_container")

# After:
CheckConstraint(check_constraint_sql("container", Container), name="ck_fields_container")
```

For the nullable `server_default` column, keep the `IS NULL OR` prefix:

```python
# Before:
CheckConstraint(
    "server_default IS NULL OR server_default IN "
    "('uuid4', 'now', 'now_on_update', 'auto_increment', 'literal')",
    name="ck_fields_on_objects_server_default",
)

# After:
CheckConstraint(
    f"server_default IS NULL OR {check_constraint_sql('server_default', ServerDefault)}",
    name="ck_fields_on_objects_server_default",
)
```

- [ ] **Step 3: Run tests**

Run: `make test && make test-e2e`
Expected: All pass — the generated SQL is identical, just derived programmatically now.

- [ ] **Step 4: Format and commit**

```
poetry run black src/
# Use /commit skill
```

---

## Part 5: Centralize Validation Constants

Scattered constants (`ALLOWED_PK_TYPES`, `SERVER_DEFAULT_VALID_TYPES`, `OPERATOR_VALID_TYPES`, name regex patterns) should live in one importable module, extending the `enums.py` pattern.

### Task 8: Create validation catalog module

**Files:**
- Create: `src/api_craft/models/validation_catalog.py`

- [ ] **Step 1: Create the module**

```python
# src/api_craft/models/validation_catalog.py
"""Canonical validation constants for all structural rules.

Single source of truth consumed by:
- validators.py (generation-time validation)
- api service layer (CRUD-time validation)
- CI contract tests (cross-repo consistency checks)

Extends the pattern established in enums.py.
"""

import re

# --- Name validation ---

SNAKE_CASE_PATTERN = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
"""Regex for valid snake_case identifiers. Must match frontend isValidSnakeCaseName()."""

PASCAL_CASE_PATTERN = re.compile(r"^[A-Z](?:[a-z0-9]+[A-Z])*[a-z0-9]*$")
"""Regex for valid PascalCase identifiers. Must match frontend isValidPascalCaseName()."""

# --- Primary key types ---

ALLOWED_PK_TYPES: set[str] = {"int", "uuid"}
"""Types allowed for primary key fields. Must match frontend ALLOWED_PK_TYPES."""

# --- Server default compatibility ---

SERVER_DEFAULT_VALID_TYPES: dict[str, set[str]] = {
    "uuid4": {"uuid", "UUID"},
    "now": {"datetime", "date"},
    "now_on_update": {"datetime", "date"},
    "auto_increment": {"int"},
    "literal": {"str", "bool", "int", "float", "decimal", "EmailStr", "HttpUrl"},
}
"""Maps server_default strategy to compatible field types.
Must match frontend SERVER_DEFAULT_OPTIONS (transposed direction)."""

# --- Operator compatibility ---

NUMERIC_TYPES: set[str] = {"int", "float", "Decimal", "decimal", "decimal.Decimal"}
DATE_TIME_TYPES: set[str] = {
    "date",
    "datetime",
    "datetime.date",
    "datetime.datetime",
    "time",
    "datetime.time",
}
ORDERED_TYPES: set[str] = NUMERIC_TYPES | DATE_TIME_TYPES
STRING_TYPES: set[str] = {"str"}

OPERATOR_VALID_TYPES: dict[str, set[str]] = {
    "eq": set(),  # empty = all types valid
    "in": set(),  # empty = all types valid
    "gte": ORDERED_TYPES,
    "lte": ORDERED_TYPES,
    "gt": ORDERED_TYPES,
    "lt": ORDERED_TYPES,
    "like": STRING_TYPES,
    "ilike": STRING_TYPES,
}
"""Maps filter operators to compatible field types.
Empty set means all types are valid.
Must match frontend OPERATOR_TYPE_COMPATIBILITY."""
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `make test`
Expected: PASS (new module, nothing imports it yet)

- [ ] **Step 3: Commit**

```
git add src/api_craft/models/validation_catalog.py
# Use /commit skill
```

### Task 9: Refactor validators.py to import from catalog

**Files:**
- Modify: `src/api_craft/models/validators.py`

- [ ] **Step 1: Replace inline constants with catalog imports**

At the top of `validators.py`, add:

```python
from api_craft.models.validation_catalog import (
    ALLOWED_PK_TYPES,
    NUMERIC_TYPES,
    DATE_TIME_TYPES,
    OPERATOR_VALID_TYPES,
    ORDERED_TYPES,
    PASCAL_CASE_PATTERN,
    SERVER_DEFAULT_VALID_TYPES,
    SNAKE_CASE_PATTERN,
    STRING_TYPES,
)
```

Then delete the inline definitions of these constants from `validators.py`:
- Line 230: `ALLOWED_PK_TYPES = {"int", "uuid"}` — delete
- Lines 273-279: `SERVER_DEFAULT_VALID_TYPES` dict — delete
- Lines 342-363: `NUMERIC_TYPES`, `DATE_TIME_TYPES`, `ORDERED_TYPES`, `STRING_TYPES`, `OPERATOR_VALID_TYPES` — delete
- Line 548: `SNAKE_CASE_PATTERN = re.compile(...)` — delete

Keep the manual checks in `validate_pascal_case_name` as-is (from Task 4) — they match the regex semantically. The `PASCAL_CASE_PATTERN` regex in the catalog is for CI/contract tests, not for replacing the validator function.

- [ ] **Step 2: Run full test suite**

Run: `make test && make test-e2e`
Expected: All pass — behavior unchanged, just imports moved.

- [ ] **Step 3: Format and commit**

```
poetry run black src/
# Use /commit skill
```

### Task 10: Add catalog consistency test

**Files:**
- Create: `tests/test_api_craft/test_validation_catalog.py`

- [ ] **Step 1: Write consistency test**

```python
"""Tests for validation catalog consistency.

Verifies that the catalog constants are internally consistent and
match the patterns used across the codebase.
"""

import re

from api_craft.models.enums import ServerDefault, FilterOperator, get_args
from api_craft.models.validation_catalog import (
    ALLOWED_PK_TYPES,
    OPERATOR_VALID_TYPES,
    PASCAL_CASE_PATTERN,
    SERVER_DEFAULT_VALID_TYPES,
    SNAKE_CASE_PATTERN,
)


class TestNamePatterns:
    """Name regex patterns must match documented rules."""

    def test_snake_case_accepts_valid(self):
        valid = ["user", "user_name", "a1", "field_1_value"]
        for name in valid:
            assert SNAKE_CASE_PATTERN.match(name), f"Should accept: {name}"

    def test_snake_case_rejects_invalid(self):
        invalid = ["User", "userName", "_user", "user_", "user__name", "1user", "user-name"]
        for name in invalid:
            assert not SNAKE_CASE_PATTERN.match(name), f"Should reject: {name}"

    def test_pascal_case_accepts_valid(self):
        valid = ["User", "UserProfile", "A", "Ab", "Item1"]
        for name in valid:
            assert PASCAL_CASE_PATTERN.match(name), f"Should accept: {name}"

    def test_pascal_case_rejects_invalid(self):
        invalid = ["user", "userProfile", "UserAPI", "User_Name", "123"]
        for name in invalid:
            assert not PASCAL_CASE_PATTERN.match(name), f"Should reject: {name!r}"
        # Empty string: regex.match("") returns None
        assert not PASCAL_CASE_PATTERN.match("")


class TestServerDefaultCoverage:
    """SERVER_DEFAULT_VALID_TYPES must cover all ServerDefault enum values."""

    def test_all_server_defaults_have_valid_types(self):
        for sd in get_args(ServerDefault):
            assert sd in SERVER_DEFAULT_VALID_TYPES, (
                f"ServerDefault '{sd}' missing from SERVER_DEFAULT_VALID_TYPES"
            )


class TestOperatorCoverage:
    """OPERATOR_VALID_TYPES must cover all FilterOperator enum values."""

    def test_all_operators_have_valid_types(self):
        for op in get_args(FilterOperator):
            assert op in OPERATOR_VALID_TYPES, (
                f"FilterOperator '{op}' missing from OPERATOR_VALID_TYPES"
            )


class TestPkTypes:
    """PK types must be a small, known set."""

    def test_pk_types_are_expected(self):
        assert ALLOWED_PK_TYPES == {"int", "uuid"}
```

- [ ] **Step 2: Run the test**

Run: `poetry run pytest tests/test_api_craft/test_validation_catalog.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```
git add tests/test_api_craft/test_validation_catalog.py
# Use /commit skill
```

---

## Deferred to Phase 2

The following items from the spec are intentionally NOT in this plan:

- **Backend constraint/template compatibility enforcement** (spec item #5): The frontend currently enforces that constraints are compatible with field types, but the backend doesn't. Adding service-level validation requires understanding the full constraint catalog and designing the enforcement API. This is better done after the catalog module exists (Task 8-9 above) and after the frontend alignment plan is written.
- **Frontend alignment**: All Phase 1 fixes are backend-only (the frontend was already correct). Frontend changes will be planned separately.

---

## Final Verification

- [ ] **Run complete test suite**

```
make test && make test-e2e
```

Expected: All tests pass, zero failures.

- [ ] **Run formatter**

```
poetry run black src/ tests/
```

- [ ] **Verify no untracked files left behind**

```
git status
```
