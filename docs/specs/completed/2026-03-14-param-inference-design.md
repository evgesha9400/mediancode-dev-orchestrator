# Deterministic Path & Query Parameter Inference

**Date:** 2026-03-14
**Status:** Draft

## Problem

When a user defines path parameters and query parameters on an endpoint, the generated view body is a `# TODO` placeholder. The system cannot generate actual filtering/lookup code because there is no semantic link between parameters and object fields.

Currently:
- Path param `item_id: int` is declared independently from object `Item` with field `id: int`
- Query param `min_price: float` has no connection to `Item.price`
- The developer must manually write all filtering logic post-generation

This is structural, deterministic, boilerplate code that belongs in the generated output per the [Median Code Philosophy](../../PHILOSOPHY.md).

## Design Goals

1. **Deterministic** — same inputs always produce the same generated query code
2. **Explicit over conventional** — no naming-convention inference; every param declares its field mapping
3. **Validatable at all layers** — frontend, backend API, and MCP must enforce identical rules with trivial logic
4. **Inline with the philosophy** — generate structure, leave behavior to post-generation

## Two Endpoint Types

All endpoints reduce to exactly two patterns based on response type:

| Response type | Path params | Query params | Example |
|---|---|---|---|
| **Object** (detail) | Identify resource by PK | Not allowed | `GET /stores/{store_id}/items/{item_id}` → `Item` |
| **List of Objects** (list) | Scope by FK (optional) | Filter the collection | `GET /stores/{store_id}/items?min_price=10` → `ItemList` |

**Key insight:** all parameters on an endpoint filter the **same target object**. In `GET /stores/{store_id}/items?min_price=10`, both `store_id` and `min_price` filter `Item` — the path param by its FK field (`Item.store_id`), the query param by its value field (`Item.price`).

---

## Schema Additions

### On Endpoint

```yaml
endpoints:
  - name: GetItems
    path: /stores/{store_id}/items
    method: GET
    response: ItemList
    target: Item              # NEW — the object being queried/filtered
```

**`target`** (required for list endpoints, inferred for detail endpoints): the object whose fields all params resolve against.

Relationship between `target`, `response`, and `response_shape`:
- **Detail endpoints** (`response_shape: object`): `target` equals the `response` model. If `target` is explicitly provided, it must match `response`. If omitted, it is inferred from `response`.
- **List endpoints** (`response_shape: list`): `target` is the object inside the list and must be explicitly declared. `response` is the list wrapper (e.g., `ProductList`), `target` is the inner object (e.g., `Product`). No automatic derivation — the user always sets `target` on list endpoints.

### On Path Parameters

```yaml
path_params:
  - name: store_id
    field: store_id           # NEW — which field on target object this param filters
```

**`field`** (required): must reference a field that exists on the target object. No naming convention inference — always explicit.

Path params always filter with equality (`==`). No `operator` field is needed — the operation is always `eq`.

**`type` is derived from the field.** When `field: store_id` is set and `store_id` is a `uuid` field on the target object, the param type is automatically `uuid.UUID`. This eliminates any possibility of type mismatch between param and field.

### On Query Parameters

```yaml
query_params:
  - name: min_price
    field: price              # NEW — which field on target object
    operator: gte             # NEW — filter operation
  - name: category
    field: category
    operator: eq
```

**`field`** (required): must reference a field that exists on the target object.

**`type` is derived from the field**, same as path params. When `field: price` is set and `price` is a `Decimal` field on the target, the param type is automatically `Decimal`. Exception: the `in` operator derives `list[field type]` instead (e.g., `field: category` where `category` is `str` → param type is `list[str]`). FastAPI handles repeated query params natively: `?category=a&category=b` maps to `list[str]`.

**`operator`** (required): the filter operation to apply. Fixed enum:

| Operator | SQL equivalent | Valid field types | Derived param type |
|---|---|---|---|
| `eq` | `==` | all | same as field |
| `gte` | `>=` | numeric, date, datetime, time | same as field |
| `lte` | `<=` | numeric, date, datetime, time | same as field |
| `gt` | `>` | numeric, date, datetime, time | same as field |
| `lt` | `<` | numeric, date, datetime, time | same as field |
| `like` | `LIKE` | str | same as field |
| `ilike` | `ILIKE` | str | same as field |
| `in` | `IN` | all | `list[field type]` |

**Optionality:** all query params with `field`/`operator` are optional by default. The generated code wraps each in an `if param is not None` guard. This matches the standard pattern — list endpoints return all results when no filters are provided, and narrow results as filters are added.

### Pagination Parameters

`limit` and `offset` are special — they don't filter by a field. They control result pagination.

```yaml
query_params:
  - name: limit
    type: int
    pagination: true          # NEW — marks as pagination, no field/operator needed
  - name: offset
    type: int
    pagination: true
```

When `pagination: true`:
- `field` and `operator` are not required and must not be set
- `type` must be `int` (the only valid type for pagination)
- `name` is not constrained — the user can name them `limit`/`offset`, `page_size`/`page`, etc.

---

## Validation Rules

Seven rules, all enforceable as simple lookups at every layer:

### Rule 1: Target object is known

- Response type "Object" → target is the response model itself
- Response type "List of Objects" → target must be explicitly declared via `target` field
- If target cannot be determined → validation error

### Rule 2: Every param `field` exists on target

For each path param and query param where `pagination` is not `true`:
- `field` must match the name of a field on the target object
- If field does not exist → validation error: "Field '{field}' does not exist on '{target}'"

### Rule 3: Detail endpoint — last path param maps to PK

When response type is "Object":
- The last path param's `field` must point to a field marked as PK on the target object
- If it doesn't → validation error: "Detail endpoint's identifying param must map to the primary key"

### Rule 4: Detail endpoint — no query params

When response type is "Object":
- `query_params` must be empty or absent
- UI: Query Parameters section is hidden
- API: rejected if present

### Rule 5: List endpoint — no path param maps to PK

When response type is "List of Objects":
- No path param's `field` should point to the PK field on the target object
- PK lookup on a list endpoint doesn't make sense — use a detail endpoint instead

### Rule 6: Query param operator is compatible with field type

For query parameters, the `operator` must be valid for the referenced field's type:
- `gte`, `lte`, `gt`, `lt` → only on numeric (`int`, `float`, `Decimal`), `date`, `datetime`, `time`
- `like`, `ilike` → only on `str`
- `eq`, `in` → valid on all types

If incompatible → validation error: "Operator '{operator}' is not valid for field type '{type}'"

### Rule 7: Param type matches field type

For path and query params with a `field`:
- The param's `type` is auto-derived from the target object's field type
- These must always match — there is no independent `type` declaration on filter params
- For pagination params (`pagination: true`): `type` must be `int`

### Validation Summary

| # | Rule | Check |
|---|---|---|
| 1 | Target is known | response type determines target |
| 2 | Field exists on target | `field in target.fields` |
| 3 | Detail: last path param = PK | `last_param.field == target.pk_field` |
| 4 | Detail: no query params | `len(query_params) == 0` |
| 5 | List: no path param = PK | `all(p.field != target.pk_field for p in path_params)` |
| 6 | Operator matches field type | `operator in valid_operators[field.type]` |
| 7 | Param type = field type | auto-derived, no mismatch possible |

All seven are set membership checks or auto-derivations — trivially implementable in JS, Python, or any MCP client.

---

## UI Behavior

### Endpoint Form (not a wizard)

The existing endpoint form is enhanced with conditional visibility:

1. **Method & Path** — user types path, `{param}` placeholders auto-detected
2. **Object** — select the target object (moved above params for context)
3. **Response type toggle** — "Object" vs "List of Objects"
4. **Path Parameters** — for each `{param}` detected in path:
   - `field` dropdown populated from target object's fields
   - Type auto-derived from the selected field (read-only, not user-editable)
5. **Query Parameters** — only visible when response type is "List of Objects":
   - `field` dropdown populated from target object's fields
   - `operator` dropdown (`eq`, `gte`, `lte`, etc.), filtered by selected field's type
   - `pagination` checkbox (hides field/operator when checked)
6. **Request body** — only for POST/PUT/PATCH

### Auto-suggestions (UI convenience, not schema validation)

The frontend MAY auto-suggest field and operator based on param naming conventions:
- User types param name `min_price` → suggest `field: price, operator: gte`
- User types `max_quantity` → suggest `field: quantity, operator: lte`
- User types `category` → suggest `field: category, operator: eq`

These are suggestions the user can accept or override. The schema itself is always explicit — no convention-based inference in validation.

---

## Examples

### Example 1: Simple list endpoint

```yaml
- name: ListProducts
  path: /products
  method: GET
  response: ProductList
  target: Product
  query_params:
    - name: min_price
      field: price            # type auto-derived: Decimal
      operator: gte
    - name: max_price
      field: price            # type auto-derived: Decimal
      operator: lte
    - name: in_stock
      field: in_stock         # type auto-derived: bool
      operator: eq
    - name: category
      field: category         # type auto-derived: list[str] (in → list[field type])
      operator: in
    - name: limit
      type: int               # type explicit: pagination params have no field
      pagination: true
    - name: offset
      type: int
      pagination: true
```

### Example 2: Detail endpoint

```yaml
- name: GetProduct
  path: /products/{tracking_id}
  method: GET
  response: Product
  # target inferred: Product (response type is Object)
  path_params:
    - name: tracking_id
      field: tracking_id     # type auto-derived: uuid.UUID; must be PK on Product
```

### Example 3: Scoped list with both path and query params

```yaml
- name: ListStoreProducts
  path: /stores/{store_id}/products
  method: GET
  response: ProductList
  target: Product
  path_params:
    - name: store_id
      field: store_id        # type auto-derived: uuid.UUID; FK field on Product
  query_params:
    - name: min_price
      field: price            # type auto-derived: Decimal
      operator: gte
    - name: search
      field: name             # type auto-derived: str
      operator: ilike
    - name: limit
      type: int
      pagination: true
```

### Example 4: Nested detail endpoint

```yaml
- name: GetStoreProduct
  path: /stores/{store_id}/products/{tracking_id}
  method: GET
  response: Product
  # target inferred: Product
  path_params:
    - name: store_id
      field: store_id        # FK field; not PK, so valid as non-last param
    - name: tracking_id
      field: tracking_id     # PK field; Rule 3 requires this to be last
```

---

## Generated Code (Target State)

Given Example 3, the generated view body would be:

```python
@api_router.get(path="/stores/{store_id}/products", response_model=ProductList, tags=["Products"])
async def list_store_products(
    store_id: path.StoreId,
    min_price: query.MinPrice = None,
    search: query.Search = None,
    limit: query.Limit = None,
):
    stmt = select(Product).where(Product.store_id == store_id)

    if min_price is not None:
        stmt = stmt.where(Product.price >= min_price)
    if search is not None:
        stmt = stmt.where(Product.name.ilike(f"%{search}%"))
    if limit is not None:
        stmt = stmt.limit(limit)

    results = await session.execute(stmt)
    return ProductList(items=results.scalars().all())
```

This is fully deterministic — the same `field` + `operator` declarations always produce the same SQLAlchemy code.

---

## What This Spec Does NOT Cover

Per the philosophy, these are past the median and left to post-generation:

- **Full-text search** — requires choosing between LIKE, trigrams, tsvector, etc.
- **Join-through relationships** — when the FK doesn't live directly on the target object
- **Aggregations** — GROUP BY, COUNT, SUM on filtered results
- **Custom sort logic** — ORDER BY with dynamic field selection
- **Nested filtering** — filtering on related object fields (e.g., filter products by store name)

These require choosing between equally valid approaches and are best handled by developers or LLMs post-generation.
