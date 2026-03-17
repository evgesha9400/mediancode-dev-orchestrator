# Deterministic Path & Query Parameter Inference — Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the `api_craft` code generation library to infer parameter types from target object fields and generate deterministic SQLAlchemy filter code in views, replacing `# TODO` placeholders.

**Architecture:** Add `target`, `field`, `operator`, and `pagination` to input models. Validate all seven rules from the spec during Pydantic model construction. Derive param types from target fields in the transformer. Generate SQLAlchemy `where()`, `limit()`, and `offset()` calls in the views template.

**Tech Stack:** Python 3.13+, Pydantic v2, Mako templates, SQLAlchemy 2.x, pytest

---

## Scope Check

This plan covers the backend `api_craft` code generation library only. Frontend UI changes and API service layer (REST endpoints) changes are separate plans that depend on this one completing first.

## File Structure

### Files to Modify

| File | Responsibility |
|---|---|
| `src/api_craft/models/enums.py` | Add `FilterOperator` Literal type |
| `src/api_craft/models/input.py` | Add `target`, `field`, `operator`, `pagination` fields to input models |
| `src/api_craft/models/validators.py` | Add 7 validation functions for param inference rules |
| `src/api_craft/models/template.py` | Add `field`, `operator`, `pagination`, `target` to template models |
| `src/api_craft/transformers.py` | Derive param types from target fields, pass new fields through |
| `src/api_craft/templates/views.mako` | Generate SQLAlchemy filter code for list endpoints |
| `src/api_craft/extractors.py` | No changes expected (params already extracted by name) |
| `src/api_craft/main.py` | No changes expected (pipeline already wires extractors to templates) |

### Files to Create

| File | Responsibility |
|---|---|
| `tests/test_api_craft/test_param_inference.py` | All tests for the param inference feature |
| `tests/specs/products_api_filters.yaml` | YAML spec exercising filtered list + detail endpoints for codegen test |

---

## Chunk 1: Enum, Input Models, and Validation Rules

This chunk adds the `FilterOperator` enum, extends `InputPathParam`, `InputQueryParam`, and `InputEndpoint` with the new fields, and implements all seven validation rules.

### Task 1: Add `FilterOperator` enum

**Files:**
- Modify: `src/api_craft/models/enums.py`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Create test file with first test**

Create `tests/test_api_craft/test_param_inference.py`:

```python
# tests/test_api_craft/test_param_inference.py
"""Tests for deterministic path & query parameter inference."""

import pytest
from api_craft.models.enums import FilterOperator


class TestFilterOperatorEnum:
    def test_valid_operators(self):
        valid = ["eq", "gte", "lte", "gt", "lt", "like", "ilike", "in"]
        for op in valid:
            # Literal types accept valid values without error
            assert op in valid

    def test_all_operators_present(self):
        """FilterOperator must include all 8 operators from the spec."""
        from typing import get_args

        operators = get_args(FilterOperator)
        assert set(operators) == {"eq", "gte", "lte", "gt", "lt", "like", "ilike", "in"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestFilterOperatorEnum -v`
Expected: FAIL with `ImportError: cannot import name 'FilterOperator'`

- [ ] **Step 3: Add FilterOperator to enums.py**

In `src/api_craft/models/enums.py`, add after the existing `Cardinality` line:

```python
FilterOperator = Literal["eq", "gte", "lte", "gt", "lt", "like", "ilike", "in"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestFilterOperatorEnum -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(generation): add FilterOperator literal type for param inference
```

---

### Task 2: Extend `InputPathParam` with `field`

**Files:**
- Modify: `src/api_craft/models/input.py`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.models.input import InputPathParam


class TestInputPathParamField:
    def test_field_defaults_none(self):
        """field is optional for backward compatibility."""
        param = InputPathParam(name="item_id", type="int")
        assert param.field is None

    def test_field_accepts_value(self):
        param = InputPathParam(name="store_id", type="uuid", field="store_id")
        assert param.field == "store_id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputPathParamField -v`
Expected: FAIL with `unexpected keyword argument 'field'`

- [ ] **Step 3: Add `field` to InputPathParam**

In `src/api_craft/models/input.py`, modify `InputPathParam`:

```python
class InputPathParam(BaseModel):
    """Path parameter definition for a view.

    :ivar name: Snake_case identifier extracted from the route.
    :ivar type: Declared type string for the parameter value.
    :ivar description: Human-readable description of the parameter.
    :ivar field: Field name on the target object this param filters by.
    """

    name: SnakeCaseName
    type: str
    description: str | None = None
    field: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputPathParamField -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(generation): add field attribute to InputPathParam
```

---

### Task 3: Extend `InputQueryParam` with `field`, `operator`, `pagination`

**Files:**
- Modify: `src/api_craft/models/input.py`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.models.input import InputQueryParam


class TestInputQueryParamFields:
    def test_defaults_none(self):
        """New fields default to None/False for backward compatibility."""
        param = InputQueryParam(name="limit", type="int")
        assert param.field is None
        assert param.operator is None
        assert param.pagination is False

    def test_filter_param(self):
        param = InputQueryParam(
            name="min_price", type="float", field="price", operator="gte"
        )
        assert param.field == "price"
        assert param.operator == "gte"
        assert param.pagination is False

    def test_pagination_param(self):
        param = InputQueryParam(
            name="limit", type="int", pagination=True
        )
        assert param.pagination is True
        assert param.field is None
        assert param.operator is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputQueryParamFields -v`
Expected: FAIL with `unexpected keyword argument 'field'`

- [ ] **Step 3: Add fields to InputQueryParam**

In `src/api_craft/models/input.py`, add import for `FilterOperator` and modify `InputQueryParam`:

```python
from api_craft.models.enums import (
    Cardinality,
    FieldAppearance,
    FilterOperator,
    HttpMethod,
    ResponseShape,
    ValidatorMode,
)

# ...

class InputQueryParam(BaseModel):
    """Query parameter definition for a view.

    :ivar name: Snake_case identifier exposed to consumers.
    :ivar type: Declared type string compatible with FastAPI annotations.
    :ivar optional: Whether this parameter is optional (default False = required).
    :ivar description: Human-readable description of the parameter.
    :ivar field: Field name on the target object this param filters by.
    :ivar operator: Filter operation to apply (eq, gte, lte, etc.).
    :ivar pagination: Whether this is a pagination param (limit/offset).
    """

    name: SnakeCaseName
    type: str
    optional: bool = False
    description: str | None = None
    field: str | None = None
    operator: FilterOperator | None = None
    pagination: bool = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputQueryParamFields -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(generation): add field, operator, pagination to InputQueryParam
```

---

### Task 4: Add `target` to `InputEndpoint`

**Files:**
- Modify: `src/api_craft/models/input.py`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.models.input import InputEndpoint


class TestInputEndpointTarget:
    def test_target_defaults_none(self):
        """target is optional for backward compatibility."""
        endpoint = InputEndpoint(
            name="GetItems", path="/items", method="GET", response="Item"
        )
        assert endpoint.target is None

    def test_target_accepts_value(self):
        endpoint = InputEndpoint(
            name="GetItems",
            path="/items",
            method="GET",
            response="ItemList",
            response_shape="list",
            target="Item",
        )
        assert endpoint.target == "Item"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputEndpointTarget -v`
Expected: FAIL with `unexpected keyword argument 'target'`

- [ ] **Step 3: Add `target` to InputEndpoint**

In `src/api_craft/models/input.py`, add to `InputEndpoint`:

```python
class InputEndpoint(BaseModel):
    # ... existing fields ...
    response_shape: ResponseShape = "object"
    target: str | None = None  # NEW — the object being queried/filtered
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestInputEndpointTarget -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(generation): add target field to InputEndpoint
```

---

### Task 5: Implement validation Rules 1-7

This is the core validation logic. All seven rules are implemented as functions in `validators.py` and wired into `InputAPI._validate_references`.

**Files:**
- Modify: `src/api_craft/models/validators.py`
- Modify: `src/api_craft/models/input.py` (wire validators)
- Test: `tests/test_api_craft/test_param_inference.py`

**Important context for the implementer:**
- The existing `validators.py` contains standalone functions called from Pydantic `model_validator` methods.
- The existing pattern is: validation functions accept model instances or collections, raise `ValueError` on failure.
- The existing `InputAPI._validate_references` method calls multiple validators in sequence. We add our new validators there.
- Validation needs access to both `endpoints` and `objects` to resolve field references.

**Operator-type compatibility table (for Rule 6):**

| Operator | Valid field types |
|---|---|
| `eq`, `in` | all types |
| `gte`, `lte`, `gt`, `lt` | `int`, `float`, `Decimal`, `decimal`, `decimal.Decimal`, `date`, `datetime`, `datetime.date`, `datetime.datetime`, `time`, `datetime.time` |
| `like`, `ilike` | `str` |

- [ ] **Step 1: Write failing tests for Rule 1 (target is known)**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.models.input import (
    InputAPI,
    InputEndpoint,
    InputField,
    InputModel,
    InputPathParam,
    InputQueryParam,
)


class TestRule1TargetIsKnown:
    """Rule 1: Target object is known."""

    def test_detail_endpoint_infers_target_from_response(self):
        """Object response type → target is the response model itself."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetProduct",
                    path="/products/{product_id}",
                    method="GET",
                    response="Product",
                    response_shape="object",
                    path_params=[
                        InputPathParam(name="product_id", type="int", field="id"),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="name", type="str"),
                    ],
                ),
            ],
        )
        assert api is not None  # Validation passed

    def test_detail_endpoint_explicit_target_must_match_response(self):
        """Detail endpoint: explicit target must equal response."""
        with pytest.raises(ValueError, match="must match response"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProduct",
                        path="/products/{product_id}",
                        method="GET",
                        response="Product",
                        response_shape="object",
                        target="Other",
                        path_params=[
                            InputPathParam(name="product_id", type="int", field="id"),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="name", type="str"),
                        ],
                    ),
                    InputModel(
                        name="Other",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                        ],
                    ),
                ],
            )

    def test_list_endpoint_requires_explicit_target(self):
        """List endpoint without target raises when field params are present."""
        with pytest.raises(ValueError, match="target"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        query_params=[
                            InputQueryParam(
                                name="min_price",
                                type="float",
                                field="price",
                                operator="gte",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="price", type="float"),
                        ],
                    ),
                ],
            )

    def test_list_endpoint_with_target_passes(self):
        """List endpoint with explicit target passes validation."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetProducts",
                    path="/products",
                    method="GET",
                    response="ProductList",
                    response_shape="list",
                    target="Product",
                    query_params=[
                        InputQueryParam(
                            name="min_price",
                            type="float",
                            field="price",
                            operator="gte",
                        ),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                ),
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="price", type="float"),
                    ],
                ),
            ],
        )
        assert api is not None
```

- [ ] **Step 2: Write failing tests for Rule 2 (field exists on target)**

Append to test file:

```python
class TestRule2FieldExistsOnTarget:
    """Rule 2: Every param field exists on target."""

    def test_path_param_field_not_on_target_raises(self):
        with pytest.raises(ValueError, match="does not exist on"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProduct",
                        path="/products/{product_id}",
                        method="GET",
                        response="Product",
                        response_shape="object",
                        path_params=[
                            InputPathParam(
                                name="product_id", type="int", field="nonexistent"
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="name", type="str"),
                        ],
                    ),
                ],
            )

    def test_query_param_field_not_on_target_raises(self):
        with pytest.raises(ValueError, match="does not exist on"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        query_params=[
                            InputQueryParam(
                                name="min_price",
                                type="float",
                                field="nonexistent",
                                operator="gte",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="price", type="float"),
                        ],
                    ),
                ],
            )
```

- [ ] **Step 3: Write failing tests for Rule 3 (detail: last path param = PK)**

Append to test file:

```python
class TestRule3DetailLastParamIsPk:
    """Rule 3: Detail endpoint — last path param maps to PK."""

    def test_last_path_param_not_pk_raises(self):
        with pytest.raises(ValueError, match="primary key"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProduct",
                        path="/products/{product_name}",
                        method="GET",
                        response="Product",
                        response_shape="object",
                        path_params=[
                            InputPathParam(
                                name="product_name", type="str", field="name"
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="name", type="str"),
                        ],
                    ),
                ],
            )

    def test_last_path_param_is_pk_passes(self):
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetProduct",
                    path="/stores/{store_id}/products/{product_id}",
                    method="GET",
                    response="Product",
                    response_shape="object",
                    path_params=[
                        InputPathParam(name="store_id", type="int", field="store_id"),
                        InputPathParam(name="product_id", type="int", field="id"),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="store_id", type="int"),
                        InputField(name="name", type="str"),
                    ],
                ),
            ],
        )
        assert api is not None
```

- [ ] **Step 4: Write failing tests for Rule 4 (detail: no query params)**

Append to test file:

```python
class TestRule4DetailNoQueryParams:
    """Rule 4: Detail endpoint — no query params allowed."""

    def test_detail_with_query_params_raises(self):
        with pytest.raises(ValueError, match="query param.*not allowed.*detail"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProduct",
                        path="/products/{product_id}",
                        method="GET",
                        response="Product",
                        response_shape="object",
                        target="Product",
                        path_params=[
                            InputPathParam(name="product_id", type="int", field="id"),
                        ],
                        query_params=[
                            InputQueryParam(
                                name="include_deleted",
                                type="bool",
                                field="deleted",
                                operator="eq",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="deleted", type="bool"),
                        ],
                    ),
                ],
            )
```

- [ ] **Step 5: Write failing tests for Rule 5 (list: no path param = PK)**

Append to test file:

```python
class TestRule5ListNoPathParamPk:
    """Rule 5: List endpoint — no path param maps to PK."""

    def test_list_with_pk_path_param_raises(self):
        with pytest.raises(ValueError, match="primary key.*list endpoint"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products/{product_id}",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        path_params=[
                            InputPathParam(name="product_id", type="int", field="id"),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="name", type="str"),
                        ],
                    ),
                ],
            )

    def test_list_with_fk_path_param_passes(self):
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetStoreProducts",
                    path="/stores/{store_id}/products",
                    method="GET",
                    response="ProductList",
                    response_shape="list",
                    target="Product",
                    path_params=[
                        InputPathParam(name="store_id", type="int", field="store_id"),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                ),
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="store_id", type="int"),
                        InputField(name="name", type="str"),
                    ],
                ),
            ],
        )
        assert api is not None
```

- [ ] **Step 6: Write failing tests for Rule 6 (operator compatible with field type)**

Append to test file:

```python
class TestRule6OperatorFieldTypeCompat:
    """Rule 6: Query param operator is compatible with field type."""

    def test_gte_on_str_raises(self):
        with pytest.raises(ValueError, match="not valid for field type"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        query_params=[
                            InputQueryParam(
                                name="min_name",
                                type="str",
                                field="name",
                                operator="gte",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="name", type="str"),
                        ],
                    ),
                ],
            )

    def test_like_on_int_raises(self):
        with pytest.raises(ValueError, match="not valid for field type"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        query_params=[
                            InputQueryParam(
                                name="search_price",
                                type="int",
                                field="price",
                                operator="like",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                            InputField(name="price", type="int"),
                        ],
                    ),
                ],
            )

    @pytest.mark.parametrize(
        "field_type,operator",
        [
            ("int", "gte"),
            ("float", "lte"),
            ("Decimal", "gt"),
            ("decimal.Decimal", "lt"),
            ("date", "gte"),
            ("datetime", "lte"),
            ("datetime.date", "gt"),
            ("datetime.datetime", "lt"),
            ("time", "gte"),
            ("datetime.time", "lte"),
            ("str", "like"),
            ("str", "ilike"),
            ("str", "eq"),
            ("int", "eq"),
            ("bool", "eq"),
            ("str", "in"),
            ("int", "in"),
        ],
    )
    def test_valid_operator_field_combos(self, field_type, operator):
        """Valid operator-type combinations must pass."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetProducts",
                    path="/products",
                    method="GET",
                    response="ProductList",
                    response_shape="list",
                    target="Product",
                    query_params=[
                        InputQueryParam(
                            name="filter_val",
                            type=field_type,
                            field="value",
                            operator=operator,
                        ),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                ),
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="value", type=field_type),
                    ],
                ),
            ],
        )
        assert api is not None
```

- [ ] **Step 7: Write failing tests for pagination validation and Rule 7**

Append to test file:

```python
class TestPaginationValidation:
    """Pagination params must not have field/operator; must be int."""

    def test_pagination_with_field_raises(self):
        """pagination=True with field set is invalid."""
        with pytest.raises(ValueError, match="pagination.*field"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        query_params=[
                            InputQueryParam(
                                name="limit",
                                type="int",
                                pagination=True,
                                field="id",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                        ],
                    ),
                ],
            )

    def test_pagination_with_operator_raises(self):
        """pagination=True with operator set is invalid."""
        with pytest.raises(ValueError, match="pagination.*operator"):
            InputAPI(
                name="TestApi",
                endpoints=[
                    InputEndpoint(
                        name="GetProducts",
                        path="/products",
                        method="GET",
                        response="ProductList",
                        response_shape="list",
                        target="Product",
                        query_params=[
                            InputQueryParam(
                                name="limit",
                                type="int",
                                pagination=True,
                                operator="eq",
                            ),
                        ],
                    ),
                ],
                objects=[
                    InputModel(
                        name="ProductList",
                        fields=[InputField(name="items", type="List[Product]")],
                    ),
                    InputModel(
                        name="Product",
                        fields=[
                            InputField(name="id", type="int", pk=True),
                        ],
                    ),
                ],
            )

    def test_pagination_valid(self):
        """pagination=True with type=int and no field/operator passes."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetProducts",
                    path="/products",
                    method="GET",
                    response="ProductList",
                    response_shape="list",
                    target="Product",
                    query_params=[
                        InputQueryParam(name="limit", type="int", pagination=True),
                        InputQueryParam(name="offset", type="int", pagination=True),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                ),
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                    ],
                ),
            ],
        )
        assert api is not None


class TestBackwardCompatibility:
    """Endpoints without field/target pass validation (legacy mode)."""

    def test_legacy_endpoint_without_field_passes(self):
        """Endpoints without any field references skip param inference validation."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetItems",
                    path="/items/{item_id}",
                    method="GET",
                    response="Item",
                    path_params=[
                        InputPathParam(name="item_id", type="int"),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="Item",
                    fields=[InputField(name="name", type="str")],
                ),
            ],
        )
        assert api is not None

    def test_legacy_list_without_target_and_no_field_params_passes(self):
        """List endpoints without target and without field-based params pass."""
        api = InputAPI(
            name="TestApi",
            endpoints=[
                InputEndpoint(
                    name="GetItems",
                    path="/items",
                    method="GET",
                    response="ItemList",
                    response_shape="list",
                    query_params=[
                        InputQueryParam(name="limit", type="int", optional=True),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ItemList",
                    fields=[InputField(name="items", type="List[Item]")],
                ),
                InputModel(
                    name="Item",
                    fields=[InputField(name="name", type="str")],
                ),
            ],
        )
        assert api is not None
```

- [ ] **Step 8: Run all tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py -v`
Expected: Tests from Tasks 1-4 pass, Rule tests fail (validators not yet implemented)

- [ ] **Step 9: Implement validation functions in validators.py**

Add to `src/api_craft/models/validators.py`:

```python
# Type sets for operator compatibility (Rule 6)
NUMERIC_TYPES = {"int", "float", "Decimal", "decimal", "decimal.Decimal"}
DATE_TIME_TYPES = {"date", "datetime", "datetime.date", "datetime.datetime", "time", "datetime.time"}
ORDERED_TYPES = NUMERIC_TYPES | DATE_TIME_TYPES
STRING_TYPES = {"str"}

OPERATOR_VALID_TYPES: dict[str, set[str]] = {
    "eq": set(),      # empty = all types valid
    "in": set(),      # empty = all types valid
    "gte": ORDERED_TYPES,
    "lte": ORDERED_TYPES,
    "gt": ORDERED_TYPES,
    "lt": ORDERED_TYPES,
    "like": STRING_TYPES,
    "ilike": STRING_TYPES,
}


def _resolve_target(
    endpoint: "InputEndpoint",
    objects_by_name: dict[str, "InputModel"],
) -> "InputModel | None":
    """Resolve the target object for an endpoint.

    Returns None if the endpoint has no field-based params (legacy mode).

    :param endpoint: The endpoint to resolve target for.
    :param objects_by_name: Map of object names to InputModel.
    :returns: The resolved target InputModel, or None for legacy endpoints.
    :raises ValueError: If target cannot be determined or is invalid.
    """
    has_field_params = _has_field_params(endpoint)

    if endpoint.response_shape == "object":
        # Detail endpoint: target is the response model
        if endpoint.target and endpoint.target != endpoint.response:
            raise ValueError(
                f"Endpoint '{endpoint.name}': detail endpoint target '{endpoint.target}' "
                f"must match response '{endpoint.response}'"
            )
        target_name = endpoint.target or endpoint.response
    else:
        # List endpoint: target must be explicit when field params are used
        if has_field_params and not endpoint.target:
            raise ValueError(
                f"Endpoint '{endpoint.name}': list endpoint with field-based params "
                f"requires an explicit 'target' object"
            )
        target_name = endpoint.target

    if not target_name:
        return None

    target = objects_by_name.get(target_name)
    if not target:
        raise ValueError(
            f"Endpoint '{endpoint.name}': target '{target_name}' does not exist in objects"
        )
    return target


def _has_field_params(endpoint: "InputEndpoint") -> bool:
    """Check if an endpoint has any field-based (non-legacy) params."""
    if endpoint.path_params:
        for p in endpoint.path_params:
            if p.field is not None:
                return True
    if endpoint.query_params:
        for q in endpoint.query_params:
            if q.field is not None:
                return True
    return False


def validate_param_inference(
    endpoints: Iterable["InputEndpoint"],
    objects: Iterable["InputModel"],
) -> None:
    """Validate all seven param inference rules across endpoints.

    :param endpoints: Collection of endpoint definitions.
    :param objects: Collection of object definitions.
    :raises ValueError: If any rule is violated.
    """
    objects_by_name: dict[str, "InputModel"] = {str(obj.name): obj for obj in objects}

    for endpoint in endpoints:
        # Skip endpoints with no field-based params (legacy mode)
        if not _has_field_params(endpoint) and not endpoint.target:
            continue

        # Rule 1: Target is known
        target = _resolve_target(endpoint, objects_by_name)
        if target is None:
            continue

        target_fields = {str(f.name): f for f in target.fields}
        pk_field_names = {str(f.name) for f in target.fields if f.pk}

        # Validate pagination params (must not have field/operator)
        if endpoint.query_params:
            for qp in endpoint.query_params:
                if qp.pagination:
                    if qp.field is not None:
                        raise ValueError(
                            f"Endpoint '{endpoint.name}': pagination param '{qp.name}' "
                            f"must not have 'field' set"
                        )
                    if qp.operator is not None:
                        raise ValueError(
                            f"Endpoint '{endpoint.name}': pagination param '{qp.name}' "
                            f"must not have 'operator' set"
                        )

        # Rule 2: Every param field exists on target
        if endpoint.path_params:
            for pp in endpoint.path_params:
                if pp.field and pp.field not in target_fields:
                    raise ValueError(
                        f"Endpoint '{endpoint.name}': field '{pp.field}' "
                        f"does not exist on '{target.name}'"
                    )

        if endpoint.query_params:
            for qp in endpoint.query_params:
                if qp.field and not qp.pagination and qp.field not in target_fields:
                    raise ValueError(
                        f"Endpoint '{endpoint.name}': field '{qp.field}' "
                        f"does not exist on '{target.name}'"
                    )

        # Rule 3 & 5 depend on response_shape
        if endpoint.response_shape == "object":
            # Rule 3: Detail — last path param maps to PK
            if endpoint.path_params:
                last_param = endpoint.path_params[-1]
                if last_param.field and last_param.field not in pk_field_names:
                    raise ValueError(
                        f"Endpoint '{endpoint.name}': detail endpoint's last path "
                        f"param '{last_param.name}' must map to a primary key field, "
                        f"but '{last_param.field}' is not a PK on '{target.name}'"
                    )

            # Rule 4: Detail — no query params
            if endpoint.query_params:
                has_field_query = any(
                    qp.field is not None for qp in endpoint.query_params
                )
                if has_field_query:
                    raise ValueError(
                        f"Endpoint '{endpoint.name}': query params with field "
                        f"references are not allowed on detail (object) endpoints"
                    )

        elif endpoint.response_shape == "list":
            # Rule 5: List — no path param maps to PK
            if endpoint.path_params:
                for pp in endpoint.path_params:
                    if pp.field and pp.field in pk_field_names:
                        raise ValueError(
                            f"Endpoint '{endpoint.name}': path param '{pp.name}' "
                            f"maps to primary key field '{pp.field}' on a list endpoint. "
                            f"Use a detail endpoint for PK lookups"
                        )

        # Rule 6: Operator is compatible with field type
        if endpoint.query_params:
            for qp in endpoint.query_params:
                if qp.operator and qp.field and not qp.pagination:
                    target_field = target_fields[qp.field]
                    _validate_operator_type_compat(
                        endpoint_name=str(endpoint.name),
                        param_name=str(qp.name),
                        operator=qp.operator,
                        field_type=str(target_field.type),
                    )


def _validate_operator_type_compat(
    endpoint_name: str,
    param_name: str,
    operator: str,
    field_type: str,
) -> None:
    """Validate that an operator is compatible with the field's type.

    :param endpoint_name: Endpoint name for error messages.
    :param param_name: Param name for error messages.
    :param operator: The filter operator.
    :param field_type: The field's type string.
    :raises ValueError: If operator is incompatible with field type.
    """
    valid_types = OPERATOR_VALID_TYPES.get(operator)
    if valid_types is None:
        return  # Unknown operator — handled by Pydantic Literal validation

    if not valid_types:
        return  # Empty set = all types valid (eq, in)

    # Normalize the field type for lookup
    base_type = field_type.split(".")[0] if "." in field_type else field_type
    if field_type not in valid_types and base_type not in valid_types:
        raise ValueError(
            f"Endpoint '{endpoint_name}': operator '{operator}' is not valid "
            f"for field type '{field_type}' on param '{param_name}'"
        )
```

- [ ] **Step 10: Wire validation into InputAPI**

In `src/api_craft/models/input.py`, add import and call in `_validate_references`:

```python
from api_craft.models.validators import (
    validate_database_config,
    validate_endpoint_references,
    validate_model_field_types,
    validate_param_inference,       # NEW
    validate_path_parameters,
    validate_pk_field_types,
    validate_primary_keys,
    validate_unique_object_names,
)

# ... in InputAPI._validate_references:
    @model_validator(mode="after")
    def _validate_references(self) -> Self:
        validate_unique_object_names(self.objects)
        declared_object_names = {obj.name for obj in self.objects}
        validate_model_field_types(self.objects, declared_object_names)
        validate_endpoint_references(self.endpoints, declared_object_names)
        validate_primary_keys(self.objects)
        validate_pk_field_types(self.objects)
        validate_database_config(self.config, self.objects)
        validate_param_inference(self.endpoints, self.objects)  # NEW
        return self
```

Also update the `TYPE_CHECKING` import block in `validators.py` to include the new types:

```python
if TYPE_CHECKING:
    from api_craft.models.input import (
        InputApiConfig,
        InputEndpoint,
        InputModel,
    )
```

- [ ] **Step 11: Run all tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py -v`
Expected: ALL PASS

- [ ] **Step 12: Run full test suite to check for regressions**

Run: `cd backend && make test`
Expected: ALL PASS (existing tests use legacy mode without `field`/`target` and should be unaffected)

- [ ] **Step 13: Commit**

```
feat(generation): implement param inference validation rules 1-7
```

---

## Chunk 2: Template Model Extensions and Type Derivation

This chunk extends the template models with the new fields and implements type derivation in the transformer.

### Task 6: Extend template models

**Files:**
- Modify: `src/api_craft/models/template.py`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.models.template import (
    TemplatePathParam,
    TemplateQueryParam,
    TemplateView,
)


class TestTemplateModelExtensions:
    def test_template_path_param_has_field(self):
        param = TemplatePathParam(
            snake_name="store_id",
            camel_name="StoreId",
            type="uuid.UUID",
            title="Store Id",
            field="store_id",
        )
        assert param.field == "store_id"

    def test_template_path_param_field_defaults_none(self):
        param = TemplatePathParam(
            snake_name="item_id",
            camel_name="ItemId",
            type="int",
            title="Item Id",
        )
        assert param.field is None

    def test_template_query_param_has_field_operator_pagination(self):
        param = TemplateQueryParam(
            snake_name="min_price",
            camel_name="MinPrice",
            type="float",
            title="Min Price",
            optional=True,
            field="price",
            operator="gte",
        )
        assert param.field == "price"
        assert param.operator == "gte"
        assert param.pagination is False

    def test_template_query_param_pagination(self):
        param = TemplateQueryParam(
            snake_name="limit",
            camel_name="Limit",
            type="int",
            title="Limit",
            optional=True,
            pagination=True,
        )
        assert param.pagination is True

    def test_template_view_has_target(self):
        view = TemplateView(
            snake_name="list_products",
            camel_name="ListProducts",
            path="/products",
            method="get",
            response_model="ProductList",
            request_model=None,
            response_placeholders=None,
            query_params=[],
            path_params=[],
            response_shape="list",
            target="Product",
        )
        assert view.target == "Product"

    def test_template_view_target_defaults_none(self):
        view = TemplateView(
            snake_name="get_items",
            camel_name="GetItems",
            path="/items",
            method="get",
            response_model="Item",
            request_model=None,
            response_placeholders=None,
            query_params=[],
            path_params=[],
        )
        assert view.target is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestTemplateModelExtensions -v`
Expected: FAIL with `unexpected keyword argument 'field'`

- [ ] **Step 3: Add fields to template models**

In `src/api_craft/models/template.py`:

```python
class TemplateQueryParam(BaseModel):
    """Query parameter definition for template rendering."""

    camel_name: str
    snake_name: str
    type: str
    title: str
    optional: bool
    description: str | None = None
    field: str | None = None
    operator: str | None = None
    pagination: bool = False


class TemplatePathParam(BaseModel):
    """Path parameter definition for template rendering."""

    snake_name: str
    camel_name: str
    type: str
    title: str
    description: str | None = None
    field: str | None = None


class TemplateView(BaseModel):
    """View (endpoint) definition for template rendering."""

    snake_name: str
    camel_name: str
    path: str
    method: str
    response_model: str | None = None
    request_model: str | None
    response_placeholders: dict[str, Any] | None
    query_params: list[TemplateQueryParam]
    path_params: list[TemplatePathParam]
    tag: str | None = None
    description: str | None = None
    use_envelope: bool = True
    response_shape: ResponseShape = "object"
    target: str | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestTemplateModelExtensions -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(generation): add field/operator/pagination/target to template models
```

---

### Task 7: Update transformers to pass through new fields and derive types

**Files:**
- Modify: `src/api_craft/transformers.py`
- Test: `tests/test_api_craft/test_param_inference.py`

**Key logic:**
- `transform_path_params` and `transform_query_params` pass through `field`, `operator`, `pagination`
- `transform_endpoint` passes through `target`
- When `target` is set, a new helper `_derive_param_types` resolves param types from target fields
- The `in` operator wraps the field type in `List[...]`
- All query params with `field`/`operator` are forced optional

- [ ] **Step 1: Write failing tests for type derivation**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.transformers import transform_api


class TestTypeDerivation:
    """Param types are derived from target object fields during transform."""

    def _build_api(self, path_params=None, query_params=None, response_shape="list"):
        """Helper to build a minimal API for testing transforms."""
        objects = [
            InputModel(
                name="Product",
                fields=[
                    InputField(name="id", type="uuid.UUID", pk=True),
                    InputField(name="store_id", type="uuid.UUID"),
                    InputField(name="price", type="decimal.Decimal"),
                    InputField(name="name", type="str"),
                    InputField(name="in_stock", type="bool"),
                    InputField(name="created_at", type="datetime.date"),
                ],
            ),
        ]
        if response_shape == "list":
            objects.append(
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                )
            )
        endpoint = InputEndpoint(
            name="GetProducts",
            path="/products" if not path_params else "/stores/{store_id}/products",
            method="GET",
            response="ProductList" if response_shape == "list" else "Product",
            response_shape=response_shape,
            target="Product" if response_shape == "list" else None,
            path_params=path_params,
            query_params=query_params,
        )
        return InputAPI(
            name="TestApi",
            endpoints=[endpoint],
            objects=objects,
            config={"response_placeholders": False},
        )

    def test_path_param_type_derived_from_field(self):
        """Path param type should be derived from the target field's type."""
        api = self._build_api(
            path_params=[
                InputPathParam(name="store_id", type="uuid.UUID", field="store_id"),
            ],
        )
        result = transform_api(api)
        pp = result.views[0].path_params[0]
        assert pp.type == "uuid.UUID"
        assert pp.field == "store_id"

    def test_query_param_type_derived_from_field(self):
        """Query param type should be derived from the target field's type."""
        api = self._build_api(
            query_params=[
                InputQueryParam(
                    name="min_price", type="float", field="price", operator="gte"
                ),
            ],
        )
        result = transform_api(api)
        qp = result.views[0].query_params[0]
        assert qp.type == "decimal.Decimal"
        assert qp.field == "price"
        assert qp.operator == "gte"

    def test_in_operator_wraps_type_in_list(self):
        """The 'in' operator should produce List[field_type] param type."""
        api = self._build_api(
            query_params=[
                InputQueryParam(
                    name="names", type="str", field="name", operator="in"
                ),
            ],
        )
        result = transform_api(api)
        qp = result.views[0].query_params[0]
        assert qp.type == "List[str]"

    def test_field_query_params_forced_optional(self):
        """Query params with field/operator are forced optional."""
        api = self._build_api(
            query_params=[
                InputQueryParam(
                    name="min_price",
                    type="float",
                    field="price",
                    operator="gte",
                    optional=False,
                ),
            ],
        )
        result = transform_api(api)
        qp = result.views[0].query_params[0]
        assert qp.optional is True

    def test_pagination_params_pass_through(self):
        """Pagination params keep their declared type."""
        api = self._build_api(
            query_params=[
                InputQueryParam(name="limit", type="int", pagination=True),
            ],
        )
        result = transform_api(api)
        qp = result.views[0].query_params[0]
        assert qp.type == "int"
        assert qp.pagination is True

    def test_legacy_params_without_field_unchanged(self):
        """Params without field keep their declared type (backward compat)."""
        api = self._build_api(
            query_params=[
                InputQueryParam(name="limit", type="int", optional=True),
            ],
        )
        result = transform_api(api)
        qp = result.views[0].query_params[0]
        assert qp.type == "int"
        assert qp.field is None

    def test_target_passed_to_template_view(self):
        """The target name is passed through to TemplateView."""
        api = self._build_api(
            query_params=[
                InputQueryParam(
                    name="min_price", type="float", field="price", operator="gte"
                ),
            ],
        )
        result = transform_api(api)
        assert result.views[0].target == "Product"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestTypeDerivation -v`
Expected: FAIL (type derivation not implemented, `target` not passed through)

- [ ] **Step 3: Update transformer functions**

In `src/api_craft/transformers.py`, update `transform_query_params`, `transform_path_params`, and `transform_endpoint`:

```python
def transform_query_params(
    input_query_params: list[InputQueryParam],
    target_fields: dict[str, InputField] | None = None,
) -> list[TemplateQueryParam]:
    if not input_query_params:
        return []
    result = []
    for param in input_query_params:
        param_type = param.type
        optional = param.optional

        # Derive type from target field when field is set
        if param.field and target_fields and param.field in target_fields:
            field_type = target_fields[param.field].type
            if param.operator == "in":
                param_type = f"List[{field_type}]"
            else:
                param_type = field_type
            # All field-based query params are optional
            optional = True
        elif param.pagination:
            # Pagination params keep declared type, forced optional
            optional = True

        result.append(
            TemplateQueryParam(
                type=param_type,
                snake_name=param.name,
                camel_name=snake_to_camel(param.name),
                title=snake_to_camel(param.name),
                optional=optional,
                description=param.description,
                field=param.field,
                operator=param.operator,
                pagination=param.pagination,
            )
        )
    return result


def transform_path_params(
    input_path_params: list[InputPathParam],
    target_fields: dict[str, InputField] | None = None,
) -> list[TemplatePathParam]:
    if not input_path_params:
        return []
    result = []
    for param in input_path_params:
        param_type = param.type
        # Derive type from target field when field is set
        if param.field and target_fields and param.field in target_fields:
            param_type = target_fields[param.field].type

        result.append(
            TemplatePathParam(
                type=param_type,
                snake_name=param.name,
                camel_name=snake_to_camel(param.name),
                title=add_spaces_to_camel_case(snake_to_camel(param.name)),
                description=param.description,
                field=param.field,
            )
        )
    return result
```

Also update `transform_endpoint` to resolve target fields and pass `target`:

```python
def transform_endpoint(
    input_endpoint: InputEndpoint,
    placeholder_generator: PlaceholderGenerator,
    generate_placeholders: bool = False,
    objects_by_name: dict[str, "InputModel"] | None = None,
) -> TemplateView:
    # ... existing code for response/request validation, name building ...

    # Resolve target object fields for type derivation
    target_fields: dict[str, InputField] | None = None
    target_name: str | None = input_endpoint.target
    if objects_by_name:
        if input_endpoint.response_shape == "object" and not target_name:
            target_name = input_endpoint.response
        if target_name and target_name in objects_by_name:
            target_obj = objects_by_name[target_name]
            target_fields = {str(f.name): f for f in target_obj.fields}

    return TemplateView(
        # ... existing fields ...
        query_params=transform_query_params(
            input_endpoint.query_params, target_fields
        ),
        path_params=transform_path_params(
            input_endpoint.path_params, target_fields
        ),
        # ... existing fields ...
        target=target_name,
    )
```

And update `transform_api` to pass `objects_by_name` to `transform_endpoint`:

```python
def transform_api(input_api: InputAPI) -> TemplateAPI:
    # ... existing code ...

    # Build objects lookup for type derivation
    objects_by_name = {str(obj.name): obj for obj in input_api.objects}

    # Transform endpoints
    transformed_views = []
    for endpoint in input_api.endpoints:
        view = transform_endpoint(
            endpoint,
            placeholder_generator,
            generate_placeholders=input_api.config.response_placeholders,
            objects_by_name=objects_by_name,
        )
        # ... existing split-schema remapping ...
```

Note: Add `InputField` to the imports from `api_craft.models.input` in `transformers.py` if not already there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestTypeDerivation -v`
Expected: PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd backend && make test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```
feat(generation): derive param types from target fields in transformer
```

---

## Chunk 3: Template Code Generation

This chunk updates the `views.mako` template to generate SQLAlchemy filter code when field-based params are present.

### Task 8: Update `views.mako` to generate filter code

**Files:**
- Modify: `src/api_craft/templates/views.mako`
- Test: `tests/test_api_craft/test_param_inference.py`

**Key logic for generated code:**

When a view has `target` set and database is enabled:
- Path params with `field`: generate `.where(OrmClass.field == param)`
- Query params with `field`+`operator`: generate `if param is not None: stmt = stmt.where(...)` using the operator mapping
- Query params with `pagination=True` and name containing "limit": generate `.limit(param)`
- Query params with `pagination=True` and name containing "offset": generate `.offset(param)`
- The operator-to-SQLAlchemy mapping: `eq` -> `==`, `gte` -> `>=`, `lte` -> `<=`, `gt` -> `>`, `lt` -> `<`, `like` -> `.like(...)`, `ilike` -> `.ilike(...)`, `in` -> `.in_(...)`

- [ ] **Step 1: Write failing codegen test**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from api_craft.main import APIGenerator


class TestFilterCodeGeneration:
    """Generated views.py must contain SQLAlchemy filter code."""

    def _generate_views(self, tmp_path) -> str:
        """Generate a filtered list API and return views.py content."""
        api = InputAPI(
            name="FilterTest",
            endpoints=[
                InputEndpoint(
                    name="ListProducts",
                    path="/stores/{store_id}/products",
                    method="GET",
                    response="ProductList",
                    response_shape="list",
                    target="Product",
                    path_params=[
                        InputPathParam(
                            name="store_id", type="uuid.UUID", field="store_id"
                        ),
                    ],
                    query_params=[
                        InputQueryParam(
                            name="min_price",
                            type="float",
                            field="price",
                            operator="gte",
                        ),
                        InputQueryParam(
                            name="search",
                            type="str",
                            field="name",
                            operator="ilike",
                        ),
                        InputQueryParam(
                            name="category",
                            type="str",
                            field="category",
                            operator="eq",
                        ),
                        InputQueryParam(
                            name="tags",
                            type="str",
                            field="category",
                            operator="in",
                        ),
                        InputQueryParam(
                            name="limit", type="int", pagination=True
                        ),
                        InputQueryParam(
                            name="offset", type="int", pagination=True
                        ),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="ProductList",
                    fields=[InputField(name="items", type="List[Product]")],
                ),
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="store_id", type="uuid.UUID"),
                        InputField(name="price", type="decimal.Decimal"),
                        InputField(name="name", type="str"),
                        InputField(name="category", type="str"),
                    ],
                ),
            ],
            config={
                "response_placeholders": False,
                "database": {"enabled": True},
            },
        )
        APIGenerator().generate(api, path=str(tmp_path))
        return (tmp_path / "filter-test" / "src" / "views.py").read_text()

    def test_path_param_generates_where_clause(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "ProductRecord.store_id == store_id" in views_py

    def test_gte_operator_generates_filter(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "ProductRecord.price >= min_price" in views_py
        assert "if min_price is not None" in views_py

    def test_ilike_operator_generates_filter(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "ProductRecord.name.ilike" in views_py
        assert "if search is not None" in views_py

    def test_eq_operator_generates_filter(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "ProductRecord.category == category" in views_py

    def test_in_operator_generates_filter(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "ProductRecord.category.in_(tags)" in views_py

    def test_pagination_generates_limit_offset(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        assert "stmt.limit(limit)" in views_py or ".limit(limit)" in views_py
        assert "stmt.offset(offset)" in views_py or ".offset(offset)" in views_py

    def test_no_todo_placeholder(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        # The filtered view should NOT contain a TODO placeholder
        # Find the list_products function and check its body
        assert "select(ProductRecord)" in views_py

    def test_generated_code_compiles(self, tmp_path):
        views_py = self._generate_views(tmp_path)
        compile(views_py, "views.py", "exec")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestFilterCodeGeneration -v`
Expected: FAIL (template not yet updated)

- [ ] **Step 3: Update views.mako template**

In `src/api_craft/templates/views.mako`, replace the list GET handler section (the block starting with `% if view.method == "get" and view.response_shape == "list":`) inside the database-backed view body:

The key change is: when `view.target` is set and the view is a list GET, generate filter code instead of a plain `select()`:

```mako
% elif view.method == "get" and view.response_shape == "list" and view.target:
## Filtered list with param inference
<%
    # Collect path param where clauses (always applied)
    path_where_clauses = []
    for pp in (view.path_params or []):
        if pp.field:
            path_where_clauses.append(f"{orm_class}.{pp.field} == {pp.snake_name}")

    # Collect query param filters (applied conditionally)
    query_filters = []
    pagination_params = []
    for qp in (view.query_params or []):
        if qp.pagination:
            pagination_params.append(qp)
        elif qp.field and qp.operator:
            query_filters.append(qp)

    # Build initial select with path param wheres
    if path_where_clauses:
        where_str = ", ".join(path_where_clauses)
    else:
        where_str = None
%>\
% if where_str:
    stmt = select(${orm_class}).where(${where_str})
% else:
    stmt = select(${orm_class})
% endif
% for qp in query_filters:
    if ${qp.snake_name} is not None:
<%
    op = qp.operator
    if op == "eq":
        filter_expr = f"{orm_class}.{qp.field} == {qp.snake_name}"
    elif op == "gte":
        filter_expr = f"{orm_class}.{qp.field} >= {qp.snake_name}"
    elif op == "lte":
        filter_expr = f"{orm_class}.{qp.field} <= {qp.snake_name}"
    elif op == "gt":
        filter_expr = f"{orm_class}.{qp.field} > {qp.snake_name}"
    elif op == "lt":
        filter_expr = f"{orm_class}.{qp.field} < {qp.snake_name}"
    elif op == "like":
        filter_expr = f'{orm_class}.{qp.field}.like(f"%{{{qp.snake_name}}}%")'
    elif op == "ilike":
        filter_expr = f'{orm_class}.{qp.field}.ilike(f"%{{{qp.snake_name}}}%")'
    elif op == "in":
        filter_expr = f"{orm_class}.{qp.field}.in_({qp.snake_name})"
    else:
        filter_expr = f"{orm_class}.{qp.field} == {qp.snake_name}"
%>\
        stmt = stmt.where(${filter_expr})
% endfor
% for pp in pagination_params:
% if "limit" in pp.snake_name:
    if ${pp.snake_name} is not None:
        stmt = stmt.limit(${pp.snake_name})
% elif "offset" in pp.snake_name or "skip" in pp.snake_name:
    if ${pp.snake_name} is not None:
        stmt = stmt.offset(${pp.snake_name})
% endif
% endfor
    result = await session.execute(stmt)
    return result.scalars().all()
```

This block should be inserted as a new condition BEFORE the existing `% if view.method == "get" and view.response_shape == "list":` line so it takes priority when `view.target` is set. The existing handler remains for backward compatibility with views that have no target.

The exact edit: in the database-backed view body section, change:

```mako
% if view.method == "get" and view.response_shape == "list":
    result = await session.execute(select(${orm_class}))
    return result.scalars().all()
```

to:

```mako
% if view.method == "get" and view.response_shape == "list" and view.target:
[... filtered list code from above ...]
% elif view.method == "get" and view.response_shape == "list":
    result = await session.execute(select(${orm_class}))
    return result.scalars().all()
```

**Important:** The template also needs to resolve `orm_class` from the `target` for list endpoints. Currently it resolves from `view.response_model`. For list endpoints with `target`, we need to resolve from `target`. Update the `orm_class` computation in the `<%` block at the top of the view loop:

```mako
<%
    # ... existing code ...
    has_orm = orm_model_map and view.response_model and view.response_model in orm_model_map
    orm_class = orm_model_map.get(view.response_model, "") if orm_model_map and view.response_model else ""
    # For list endpoints with target, resolve ORM class from target instead
    if not has_orm and view.target and orm_model_map and view.target in orm_model_map:
        orm_class = orm_model_map[view.target]
        has_orm = True
    # ... existing delete code ...
%>
```

Additionally, we need to add the target object's ORM class to the import list. In the `<%` block at the top of the template where `orm_model_names_from_response` is computed, add:

```mako
orm_model_names_from_target = set()
if orm_model_map:
    for view in views:
        if view.target and view.target in orm_model_map:
            orm_model_names_from_target.add(orm_model_map[view.target])
orm_model_names = sorted(orm_model_names_from_response | orm_model_names_from_pk | orm_model_names_from_target)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestFilterCodeGeneration -v`
Expected: PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd backend && make test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```
feat(generation): generate SQLAlchemy filter code from param field/operator
```

---

### Task 9: Add YAML spec and codegen integration test

**Files:**
- Create: `tests/specs/products_api_filters.yaml`
- Modify: `tests/test_api_craft/conftest.py`
- Modify: `tests/test_api_craft/test_param_inference.py`

This task creates an integration test that generates a full API with filters, boots it, and makes HTTP requests.

- [ ] **Step 1: Create the spec YAML**

Create `tests/specs/products_api_filters.yaml`:

```yaml
name: ProductsFilterApi
version: "0.1.0"
author: Median Code
description: Products API with filtered list endpoints

tags:
  - name: Products
    description: Product operations

objects:
  - name: Product
    description: A product with filterable fields
    fields:
      - name: id
        type: int
        pk: true
        description: Product ID

      - name: store_id
        type: int
        description: Store this product belongs to

      - name: name
        type: str
        description: Product name

      - name: price
        type: float
        description: Product price

      - name: category
        type: str
        description: Product category

      - name: in_stock
        type: bool
        description: Whether product is in stock

  - name: ProductList
    description: List response wrapper
    fields:
      - name: items
        type: List[Product]
        description: List of products
      - name: total
        type: int
        description: Total count

endpoints:
  - name: GetProduct
    path: /products/{product_id}
    method: GET
    tag: Products
    response: Product
    response_shape: object
    path_params:
      - name: product_id
        type: int
        field: id

  - name: ListProducts
    path: /stores/{store_id}/products
    method: GET
    tag: Products
    response: Product
    response_shape: list
    target: Product
    path_params:
      - name: store_id
        type: int
        field: store_id
    query_params:
      - name: min_price
        type: float
        field: price
        operator: gte
      - name: max_price
        type: float
        field: price
        operator: lte
      - name: search
        type: str
        field: name
        operator: ilike
      - name: category
        type: str
        field: category
        operator: eq
      - name: limit
        type: int
        pagination: true
      - name: offset
        type: int
        pagination: true

config:
  healthcheck: /healthcheck
  response_placeholders: false
  database:
    enabled: true
```

- [ ] **Step 2: Add fixture to conftest.py**

Append to `tests/test_api_craft/conftest.py`:

```python
@pytest.fixture(scope="session")
def products_filter_api_client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """Generate Products Filter API once per session and return TestClient."""
    tmp_path = tmp_path_factory.mktemp("products_filter_api")

    api_input = load_input("products_api_filters.yaml")
    APIGenerator().generate(api_input, path=str(tmp_path))

    src_path = tmp_path / "products-filter-api" / "src"
    app = load_app(src_path)

    return TestClient(app)
```

- [ ] **Step 3: Write integration tests**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
from fastapi.testclient import TestClient

pytestmark = pytest.mark.codegen


class TestProductsFilterApiIntegration:
    """Integration tests: generate, boot, and request the filtered API."""

    def test_healthcheck(self, products_filter_api_client: TestClient):
        response = products_filter_api_client.get("/healthcheck")
        assert response.status_code == 200

    def test_list_products_no_filters(self, products_filter_api_client: TestClient):
        """GET /stores/1/products returns 200 with no filters."""
        response = products_filter_api_client.get("/stores/1/products")
        assert response.status_code == 200

    def test_list_products_with_filters(self, products_filter_api_client: TestClient):
        """GET /stores/1/products with query params returns 200."""
        response = products_filter_api_client.get(
            "/stores/1/products?min_price=10.0&max_price=100.0&search=test&category=electronics&limit=10&offset=0"
        )
        assert response.status_code == 200

    def test_get_product_by_id(self, products_filter_api_client: TestClient):
        """GET /products/1 returns 404 (no data seeded, but proves query works)."""
        response = products_filter_api_client.get("/products/1")
        assert response.status_code == 404
```

- [ ] **Step 4: Run integration tests**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestProductsFilterApiIntegration -v`
Expected: PASS (200s for list endpoints, 404 for detail since no data)

- [ ] **Step 5: Run full test suite**

Run: `cd backend && make test`
Expected: ALL PASS

- [ ] **Step 6: Format code**

Run: `cd backend && poetry run black src/ tests/`

- [ ] **Step 7: Commit**

```
feat(generation): add integration test for param inference filter codegen
```

---

## Chunk 4: Detail endpoint filter code and edge cases

### Task 10: Generate detail endpoint filter code from field-based path params

Currently detail endpoints with database generate `where(OrmClass.pk_param == pk_param)` using the first path param name directly. With the new `field` attribute, we can now use the actual field name for more accurate queries (e.g., when the param name differs from the field name like `tracking_id` param mapping to `tracking_id` field).

**Files:**
- Modify: `src/api_craft/templates/views.mako`
- Test: `tests/test_api_craft/test_param_inference.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_api_craft/test_param_inference.py`:

```python
class TestDetailEndpointFilterCodeGen:
    """Detail endpoints should use field-based where clauses."""

    def test_detail_with_field_uses_field_in_where(self, tmp_path):
        api = InputAPI(
            name="DetailFieldTest",
            endpoints=[
                InputEndpoint(
                    name="GetProduct",
                    path="/products/{tracking_id}",
                    method="GET",
                    response="Product",
                    response_shape="object",
                    path_params=[
                        InputPathParam(
                            name="tracking_id", type="uuid", field="tracking_id"
                        ),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="tracking_id", type="uuid", pk=True),
                        InputField(name="name", type="str"),
                    ],
                ),
            ],
            config={
                "response_placeholders": False,
                "database": {"enabled": True},
            },
        )
        APIGenerator().generate(api, path=str(tmp_path))
        views_py = (tmp_path / "detail-field-test" / "src" / "views.py").read_text()

        # Should use field name in where clause
        assert "ProductRecord.tracking_id == tracking_id" in views_py
        compile(views_py, "views.py", "exec")

    def test_nested_detail_with_scoping_param(self, tmp_path):
        """Nested detail: /stores/{store_id}/products/{product_id}"""
        api = InputAPI(
            name="NestedDetailTest",
            endpoints=[
                InputEndpoint(
                    name="GetStoreProduct",
                    path="/stores/{store_id}/products/{product_id}",
                    method="GET",
                    response="Product",
                    response_shape="object",
                    path_params=[
                        InputPathParam(
                            name="store_id", type="int", field="store_id"
                        ),
                        InputPathParam(
                            name="product_id", type="int", field="id"
                        ),
                    ],
                ),
            ],
            objects=[
                InputModel(
                    name="Product",
                    fields=[
                        InputField(name="id", type="int", pk=True),
                        InputField(name="store_id", type="int"),
                        InputField(name="name", type="str"),
                    ],
                ),
            ],
            config={
                "response_placeholders": False,
                "database": {"enabled": True},
            },
        )
        APIGenerator().generate(api, path=str(tmp_path))
        views_py = (tmp_path / "nested-detail-test" / "src" / "views.py").read_text()

        # Both path params should appear as where clauses
        assert "ProductRecord.store_id == store_id" in views_py
        assert "ProductRecord.id == product_id" in views_py
        compile(views_py, "views.py", "exec")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestDetailEndpointFilterCodeGen -v`
Expected: FAIL (current template uses `pk_param` directly, not `field`)

- [ ] **Step 3: Update views.mako for detail endpoints with field-based params**

In the detail GET handler, add a new condition before the existing one:

```mako
% if view.method == "get" and view.response_shape != "list" and view.target:
## Detail endpoint with field-based path params
<%
    where_clauses = []
    for pp in (view.path_params or []):
        if pp.field:
            where_clauses.append(f"{orm_class}.{pp.field} == {pp.snake_name}")
        else:
            where_clauses.append(f"{orm_class}.{pp.snake_name} == {pp.snake_name}")
    where_str = ", ".join(where_clauses)
%>\
    result = await session.execute(select(${orm_class}).where(${where_str}))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="${view.response_model} not found")
    return record
% elif view.method == "get":
```

This inserts before the existing detail handler. The existing handler remains for backward compatibility.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api_craft/test_param_inference.py::TestDetailEndpointFilterCodeGen -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd backend && make test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```
feat(generation): use field-based where clauses for detail endpoints
```

---

### Task 11: Final full suite run and formatting

- [ ] **Step 1: Format all code**

Run: `cd backend && poetry run black src/ tests/`

- [ ] **Step 2: Run full test suite**

Run: `cd backend && make test`
Expected: ALL PASS

- [ ] **Step 3: Run e2e tests if available**

Run: `cd backend && make test-e2e` (if applicable)
Expected: ALL PASS

- [ ] **Step 4: Final commit if any formatting changes**

```
chore(generation): format param inference code
```

---

## Summary of Changes by File

| File | Changes |
|---|---|
| `src/api_craft/models/enums.py` | Add `FilterOperator` Literal |
| `src/api_craft/models/input.py` | Add `field` to `InputPathParam`, `field`/`operator`/`pagination` to `InputQueryParam`, `target` to `InputEndpoint`, wire `validate_param_inference` |
| `src/api_craft/models/validators.py` | Add `validate_param_inference` and helpers for all 7 rules |
| `src/api_craft/models/template.py` | Add `field` to `TemplatePathParam`, `field`/`operator`/`pagination` to `TemplateQueryParam`, `target` to `TemplateView` |
| `src/api_craft/transformers.py` | Pass `target_fields` and `objects_by_name` to param transformers, derive types from fields, pass `target` through |
| `src/api_craft/templates/views.mako` | Generate SQLAlchemy filter code for list + detail endpoints with field params |
| `tests/test_api_craft/test_param_inference.py` | All new tests: enum, input models, 7 rules, template models, type derivation, codegen, integration |
| `tests/specs/products_api_filters.yaml` | Spec for integration test |
| `tests/test_api_craft/conftest.py` | Add `products_filter_api_client` fixture |

## What This Plan Does NOT Cover

- **API service layer** (`src/api/`): Database schema migrations, endpoint CRUD schema updates, and generation service updates are a separate plan.
- **Frontend**: UI changes for the new endpoint form fields.
- **MCP**: No MCP changes needed (validation runs in api_craft, not MCP).
