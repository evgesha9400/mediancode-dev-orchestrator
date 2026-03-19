# Spec: Shop API Seed Module

## Problem

The Shop API seed dataset has **four drifting representations**:

1. **`docs/seed-shop-api.sql`** (373 lines) -- raw SQL INSERTs. 23 fields, email as Customer PK, includes `appears` and relationships, 9 endpoints. Bypasses all API validation.
2. **`tests/test_api/test_e2e_shop_full.py`** (~1127 lines) -- creates via REST API. 24 fields, `customer_id` as Customer PK, no relationships, no `appears`, 7 endpoints.
3. **`scripts/test_generation.py`** (~454 lines) -- duplicates the E2E test's field definitions. References `test_e2e_shop.py` (wrong filename). No `isPk`, no relationships, no `appears`.
4. **`tests/specs/shop_api.yaml`** -- spec-format definition of the Shop API, separate from all three above.

Consequences:
- The SQL file bypasses API validation, allowing invalid structures the API would reject.
- Each representation continues to drift independently.
- No way to seed live environments (local, dev, prod) through the API for validation.
- Live seeding requires Clerk JWT authentication, which none of the current approaches handle.

## Goals

1. **Single source of truth** for the Shop API seed data definition.
2. **API-validated seeding** -- all data goes through REST API endpoints, never raw SQL.
3. **Dual use** -- importable by E2E tests (in-process, no auth) and runnable as a standalone CLI script (Clerk JWT auth, configurable target environment).
4. **Configurable target** -- local, dev, or prod via CLI args.
5. **Eliminate drift** -- delete the SQL file and `scripts/test_generation.py`, refactor E2E test to import shared definitions.

## Non-Goals

- Building a generic seeding framework for arbitrary API definitions (this is Shop-specific).
- Transactional rollback on partial failure (the backend commits per request).
- Custom DSL or migration engine.

## Design

### Module Structure

Location: `src/api/seeding/` inside the backend repo.

```
src/api/seeding/
    __init__.py              # Public API: seed_shop(), clean_shop(), SeedResult
    shop_data.py             # Canonical Shop seed data (final desired state)
    runner.py                # Catalogue resolution, ordered creation, cleanup
    clerk_auth.py            # Clerk JWT minting for live APIs
    __main__.py              # CLI entrypoint (python -m api.seeding)
```

**Why `src/api/seeding/` and not `scripts/`:**
- `scripts/test_generation.py` already proved that script-only logic drifts because tests cannot import from it.
- Both tests and CLI need the same code. `src/api/` is the importable code path.

### Canonical Shop Seed Data

`shop_data.py` defines the **final desired state** using plain Python dicts with symbolic name references. No dataclasses for seed data definitions -- the data is consumed once by the runner and validated by the API itself. Adding a type layer would be ceremony without value. (The runner's `SeedResult` return type uses a dataclass since it is passed around and accessed by callers.)

References use catalogue names (e.g., `type: "str"`, `constraint: "min_length"`) rather than UUIDs. The runner resolves these to real IDs at runtime by querying the read-only catalogues.

#### Fields (24 total)

**Product fields (16):**

| Field | Type | Constraints | Validators |
|-------|------|------------|------------|
| name | str | min_length=1, max_length=150 | Trim, Normalize Whitespace |
| sku | str | pattern=`^[A-Z]{2}-\d{4}$` | Normalize Case (upper) |
| price | Decimal | gt=0 | Round Decimal (places=2) |
| sale_price | Decimal | ge=0 | -- |
| sale_end_date | date | -- | -- |
| weight | float | ge=0, lt=1000 | Clamp to Range (0-1000) |
| quantity | int | ge=0 | -- |
| min_order_quantity | int | ge=1 | -- |
| max_order_quantity | int | le=1000 | -- |
| discount_percent | int | ge=0, le=100, multiple_of=5 | -- |
| discount_amount | Decimal | ge=0 | -- |
| in_stock | bool | -- | -- |
| product_url | HttpUrl | -- | -- |
| release_date | date | -- | -- |
| created_at | datetime | -- | -- |
| tracking_id | uuid | -- | -- |

**Customer fields (8):**

| Field | Type | Constraints | Validators |
|-------|------|------------|------------|
| customer_id | int | -- | -- |
| customer_name | str | min_length=1, max_length=100 | Trim, Normalize Case (title), Trim To Length (100) |
| email | EmailStr | -- | -- |
| phone | str | min_length=7, max_length=15 | -- |
| date_of_birth | date | -- | -- |
| last_login_time | time | -- | -- |
| is_active | bool | -- | -- |
| registered_at | datetime | -- | -- |

#### Objects

**Product** (16 fields):
- PK: `tracking_id` (uuid)
- Optional fields: `sale_price`, `sale_end_date`, `max_order_quantity`, `discount_percent`, `discount_amount`
- Required fields: all others including `min_order_quantity`
- `appears` overrides: `created_at` = `response`
- Model validators:
  1. Field Comparison (`<`): min_order_quantity vs max_order_quantity
  2. Mutual Exclusivity: discount_percent vs discount_amount
  3. All Or None: sale_price + sale_end_date
  4. Conditional Required: discount_percent triggers sale_price

**Customer** (8 fields):
- PK: `customer_id` (int, autoincrement)
- Optional fields: `email`, `phone`
- `appears` overrides: `registered_at` = `response`
- Model validators:
  1. At Least One Required: email vs phone

#### Relationship

Customer `has_many` Products (bidirectional):

| Direction | Source | Target | Name | Cardinality | is_inferred |
|-----------|--------|--------|------|-------------|-------------|
| Forward | Customer | Product | products | has_many | false |
| Inverse | Product | Customer | customer | references | true |

The runner creates the forward relationship on Customer via `POST /objects/{customer_id}/relationships`, then creates the inverse on Product, then links their `inverse_id` fields.

#### API

- Title: `ShopApi`
- Version: `1.0.0`
- Description: `Complete online shop API`
- Namespace: `Shop` (`isDefault: false` -- POST /namespaces defaults to non-default)

#### Endpoints (9)

| Method | Path | Description | Tag | Object | Path Params | Response Shape |
|--------|------|-------------|-----|--------|-------------|----------------|
| GET | /products | List all products | Products | Product | -- | list |
| GET | /products/{tracking_id} | Get product by tracking ID | Products | Product | tracking_id (field) | object |
| POST | /products | Create a product | Products | Product | -- | object |
| PUT | /items/{tracking_id} | Update a product | Products | Product | tracking_id (field) | object |
| DELETE | /products/{tracking_id} | Delete a product | Products | -- | tracking_id (field) | object |
| GET | /customers | List all customers | Customers | Customer | -- | list |
| POST | /customers | Create a customer | Customers | Customer | -- | object |
| GET | /customers/{email} | Get customer by email | Customers | Customer | email (field) | object |
| PATCH | /customers/{email} | Update a customer by email | Customers | Customer | email (field) | object |

All endpoints: `useEnvelope = false`.

### Runner

`runner.py` exports two async functions:

```python
async def seed_shop(client: AsyncClient) -> SeedResult:
    """Create the full Shop API structure via API calls."""

async def clean_shop(client: AsyncClient) -> None:
    """Delete the Shop namespace and all its contents."""
```

**`seed_shop` execution order:**

1. **Read catalogues** -- GET /types, /field-constraints, /field-validator-templates, /model-validator-templates. Build name-to-ID maps.
2. **Create namespace** -- POST /namespaces `{"name": "Shop"}`.
3. **Create fields** -- POST /fields for each of the 24 fields, with constraints and validators resolved from catalogue maps.
4. **Create objects** -- POST /objects for Product and Customer, with field references resolved from step 3 IDs. Includes `appears`, `isPk`, `optional`, and model validators.
5. **Create relationship** -- POST /objects/{customer_id}/relationships to create Customer has_many Products. Then create the inverse relationship.
6. **Create API** -- POST /apis.
7. **Create endpoints** -- POST /endpoints for all 9, with object and field path param references resolved from earlier steps.

**`clean_shop` execution order:**

1. List endpoints (GET /endpoints), delete each.
2. Get API (GET /apis), delete it.
3. List objects (GET /objects?namespace_id=...), delete each (cascade deletes relationships).
4. List fields (GET /fields?namespace_id=...), delete each.
5. Delete namespace (DELETE /namespaces/{id}).

**Return type:**

```python
@dataclass
class SeedResult:
    namespace_id: str
    field_ids: dict[str, str]        # field_name -> id
    object_ids: dict[str, str]       # object_name -> id
    api_id: str
    endpoint_ids: dict[str, str]     # "METHOD /path" -> id
    relationship_ids: list[str]
```

### Auth Handling

The runner is **auth-agnostic** -- it accepts any `httpx.AsyncClient`. Callers configure auth:

**In tests** (in-process, no network):
```python
app.dependency_overrides[get_current_user] = lambda: TEST_CLERK_ID
client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test/v1")
result = await seed_shop(client)
```

**In live mode** (real network, Clerk JWT):

`clerk_auth.py` handles JWT acquisition:
1. Load `CLERK_SECRET_KEY` from environment (already in `.env.local`).
2. Call Clerk Backend API: `GET https://api.clerk.com/v1/users?email_address[]=<email>` to find the user.
3. Call Clerk Backend API: `GET https://api.clerk.com/v1/sessions?user_id=<id>&status=active` to get an active session.
4. Call Clerk Backend API: `POST https://api.clerk.com/v1/sessions/<session_id>/tokens` to mint a JWT.
5. Return the JWT string.

The CLI constructs the client:
```python
jwt = await mint_clerk_jwt(email, clerk_secret_key)
client = AsyncClient(base_url=base_url, headers={"Authorization": f"Bearer {jwt}"})
```

**Manual override:** `--bearer-token` CLI arg skips the Clerk flow entirely for cases where the user already has a token.

### Error Handling

**Fail fast.** The backend commits per request (`src/api/database.py`), so a multi-call seed run cannot be one atomic transaction.

- On any non-2xx response: raise `SeedError` with entity type, name, HTTP status, and response body.
- Print resources already created before the failure.
- Leave cleanup to explicit `--mode replace` or `--mode delete`.
- No retry on 4xx (validation failure = bug in seed data).
- No skip-if-exists logic in the runner itself.

```python
class SeedError(Exception):
    """Raised when a seed API call fails."""
    def __init__(self, entity_type: str, name: str, status_code: int, detail: str):
        ...
```

### Idempotency and Modes

Three CLI modes control behavior when data already exists:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `replace` (default) | Delete existing Shop namespace subtree, then recreate from scratch | Dev environments, fresh seeding |
| `apply` | POST if entity is missing, PUT if it exists. Fail on ambiguous duplicates | Prod-safe incremental updates |
| `delete` | Remove the Shop namespace subtree only | Cleanup |

`replace` mode calls `clean_shop()` first, then `seed_shop()`.

`apply` mode queries existing entities by name within the namespace:
- Namespace: find by name.
- Fields: list by namespace, match by name.
- Objects: list by namespace, match by name.
- API: list by namespace, match by title.
- Endpoints: list, match by method+path.
- POST if not found, PUT if found.

Note: `apply` mode assumes all entity PUT endpoints accept the same shape as POST. This holds for the current API implementation (verified in the E2E test's update phases for fields, objects, APIs, and endpoints).

### CLI Interface

Entrypoint: `poetry run python -m api.seeding`

```
usage: python -m api.seeding [OPTIONS]

Required:
  --base-url URL        Target API base URL (e.g., http://localhost:8001/v1)
  --user-email EMAIL    Clerk user email to seed data for

Optional:
  --bearer-token TOKEN  Skip Clerk JWT flow, use this token directly
  --mode MODE           replace (default) | apply | delete
  --verbose             Print detailed progress
```

Convenience aliases via `--target`:
```
  --target local        Alias for --base-url http://localhost:8001/v1
  --target dev          Alias for --base-url https://api.dev.mediancode.com/v1
  --target prod         Alias for --base-url https://api.mediancode.com/v1
```

`--target` and `--base-url` are mutually exclusive -- providing both is an error.

Example invocations:
```bash
# Local dev
poetry run python -m api.seeding --target local --user-email aleshiner@mail.ru

# Dev environment
poetry run python -m api.seeding --target dev --user-email aleshiner@mail.ru --mode apply

# Delete Shop data from prod
poetry run python -m api.seeding --target prod --user-email aleshiner@mail.ru --mode delete

# With manual token
poetry run python -m api.seeding --target dev --user-email aleshiner@mail.ru --bearer-token eyJ...
```

### Test Integration

The E2E test (`test_e2e_shop_full.py`) is **refactored to import shared definitions from `shop_data.py`** but **retains its own lifecycle testing**.

**What moves to `shop_data.py`** (shared):
- `PRODUCT_FIELDS`, `CUSTOMER_FIELDS` -- field definitions with types, constraints, validators
- `PRODUCT_OPTIONAL`, `CUSTOMER_OPTIONAL` -- optionality sets
- Object definitions (field associations, model validators, `appears`)
- Endpoint definitions
- Relationship definitions

**What stays in the E2E test** (test-specific):
- Phase 1: Read catalogues + assertions
- Phase 2: Create namespace + assertions
- Phase 3: Create fields (using shared data) + assertions
- Phase 4: Read and verify fields
- Phase 5: Update fields (create with initial values, then update -- this tests the update API, not the final state)
- Phase 6: Create objects (using shared data) + assertions
- Phase 7-8: Read/update object assertions
- Phase 9-13: API/endpoint CRUD + assertions (all 9 endpoints, matching the canonical set from `shop_data.py`)
- Phase 14-18: Generate and verify
- Phase 19-26: Cleanup

**How update phases work with shared data:**

The shared definitions in `shop_data.py` represent the **final desired state**. The E2E test's update phases test API state transitions by overriding the starting state for specific fields. For example:

- Phase 3 creates `name` with `max_length=200` (test-local override of the shared definition's `150`).
- Phase 5 updates `name` to `max_length=150` (matching the shared final state) and verifies the update persisted.
- Phase 3 creates `customer_name` with 2 validators (test-local override). Phase 5 adds the third, matching the shared final state.

The test imports the shared field list but **overrides specific constraint/validator values at creation time** for fields it plans to update. The update payloads then bring those fields to the final state defined in `shop_data.py`. This preserves the test's value (verifying PUT/PATCH works) while using the shared data as the target state.

The update phases (5, 8, 10, 13) are the test's unique value -- they verify API state transitions. The seed module only creates the final state.

**E2E test must also add:**
- The 2 missing endpoints: `POST /customers` and `GET /customers/{email}` (matching the canonical 9 endpoints)
- Customer-Product relationship creation and assertions
- `appears` field on object-field associations (`created_at` = response, `registered_at` = response)

**`scripts/test_generation.py`** is deleted -- fully replaced by `python -m api.seeding`.

### Files Changed

| File | Action |
|------|--------|
| `src/api/seeding/__init__.py` | Create |
| `src/api/seeding/shop_data.py` | Create |
| `src/api/seeding/runner.py` | Create |
| `src/api/seeding/clerk_auth.py` | Create |
| `src/api/seeding/__main__.py` | Create |
| `tests/test_api/test_e2e_shop_full.py` | Update -- import shared defs, add missing endpoints/relationships/appears |
| `scripts/test_generation.py` | Delete |
| `docs/seed-shop-api.sql` | Delete |

### Philosophy Alignment

| Principle | How This Spec Applies It |
|-----------|-------------------------|
| Generate structure, leave behavior | Seed defines structural API state only. Update-path testing stays in tests. |
| Deterministic output | Same seed data + same catalogues = same API structure, always. |
| Automate what's tedious | Catalogue lookup, ID resolution, ordered creation, auth bootstrapping -- all centralized. |
| Don't over-engineer | Plain dicts, no DSL, no migration engine, no custom ORM. Three modes, not ten. |
| Respect the boundary | All data goes through the API. The SQL shortcut is eliminated. |
