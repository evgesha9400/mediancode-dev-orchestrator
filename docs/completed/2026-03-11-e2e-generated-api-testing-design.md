# E2E Testing for Generated APIs

**Date:** 2026-03-11
**Status:** Draft

## Problem

Unit tests pass while generated APIs crash at runtime. Missing dependencies (greenlet), port conflicts, broken imports — all invisible to unit tests. The user went through 12 manual iterations of generate → extract → setup → start → test, finding bugs each time.

## Solution

An automated E2E test that does exactly what the user does manually: generate a project from `shop_api.yaml`, start it with Docker Compose, and hit every endpoint.

## Scope

Four deliverables:

1. **Centralized port config in generated projects**
2. **Sync `shop_api.yaml` to match `docs/seed-shop-api.sql`** (+ add 2 new endpoints to SQL)
3. **Fix stale seed.py/db-seed references in `readme.mako`**
4. **E2E test suite**

---

## 1. Centralized Port Configuration

### Current State

Ports are hardcoded in 5 locations:
- `docker_compose.mako`: `5433:5432` (DB), `8001:80` (app)
- `makefile.mako`: `--port 8001`, `-p 8001:80`
- `alembic_ini.mako`: `localhost:5433`
- `readme.mako`: `http://localhost:8001`
- `transformers.py`: `localhost:5433` in default DATABASE_URL

### Design

Add `app_port` to `TemplateAPI` (always available, used by Makefile/README even without DB).
Add `db_port` to `TemplateDatabaseConfig` (only relevant when DB enabled).

**Model changes** (`src/api_craft/models/template.py`):
```python
class TemplateAPI(BaseModel):
    # ... existing fields ...
    app_port: int = 8001

class TemplateDatabaseConfig(BaseModel):
    enabled: bool
    default_url: str
    db_port: int = 5433
```

**Transformer change** (`src/api_craft/transformers.py`):
Build `default_url` from `db_port` instead of hardcoding:
```python
default_url=f"postgresql+asyncpg://postgres:postgres@localhost:{db_port}/{snake_name}"
```

**Template changes** — all templates reference `api.app_port` and `api.database_config.db_port` instead of hardcoded values.

**New template: `env.mako`** — generates `.env` file (only when DB enabled):
```
DB_PORT=5433
APP_PORT=8001
```

**docker_compose.mako** uses Docker Compose env var interpolation:
```yaml
ports:
  - "${DB_PORT:-5433}:5432"
  - "${APP_PORT:-8001}:80"
```

**makefile.mako** uses `-include .env` (non-fatal if missing) + export:
```makefile
-include .env
export
```
Targets reference `$(APP_PORT)` with fallback defaults.

**alembic_ini.mako** keeps static fallback URL using `api.database_config.db_port`. The `env.py` override from `DATABASE_URL` takes precedence at runtime.

**readme.mako** references `api.app_port` for all URL references and documents the `.env` file for port configuration.

### Files Modified

- `src/api_craft/models/template.py` — add `app_port` to `TemplateAPI`, add `db_port` to `TemplateDatabaseConfig`
- `src/api_craft/transformers.py` — use port fields instead of hardcoded values
- `src/api_craft/templates/docker_compose.mako` — use `${DB_PORT}` / `${APP_PORT}` env vars
- `src/api_craft/templates/makefile.mako` — `-include .env`, use `$(APP_PORT)`
- `src/api_craft/templates/alembic_ini.mako` — use `api.database_config.db_port`
- `src/api_craft/templates/readme.mako` — use `api.app_port`, document `.env` config
- `src/api_craft/templates/env.mako` — **new file**, generates `.env`
- `src/api_craft/renderers.py` — add `render_env()` function
- `src/api_craft/main.py` — write `.env` file to output

---

## 2. Sync shop_api.yaml to seed-shop-api.sql

`docs/seed-shop-api.sql` is source of truth. `tests/specs/shop_api.yaml` will be rewritten to match exactly.

### Structural Changes

The YAML must include:
- `config.database.enabled: true`
- `config.response_placeholders: false` (DB-backed responses, not placeholder data)
- `pk: true` on `tracking_id` (Product) and `customer_id` (Customer)
- `use_envelope: false` on all endpoints (SQL sets this to false for all)

The current YAML has 7 objects (Product, ProductList, CreateProductRequest, Customer, CustomerList, UpdateCustomerRequest, GetCustomer). The rewrite consolidates to **2 objects** (Product, Customer). The generator creates appropriate request/response schemas from these — PK fields are excluded from request bodies (server-generated) and included in responses.

### Field Changes

**Product object** (16 fields, `tracking_id` as UUID PK):
- Remove: `cost`, `is_on_sale`, `sale_start`, `website_url`, `is_active`
- Add: `sale_price` (Decimal, optional), `sale_end_date` (date, optional), `discount_amount` (Decimal, optional), `in_stock` (bool), `product_url` (HttpUrl)
- Optionality changes: `max_order_quantity` → optional, `discount_percent` → optional, `weight` → required, `release_date` → required

**Customer object** (8 fields, `customer_id` as int auto-increment PK):
- Remove: `preferred_contact_time`, `website`
- Add: `customer_id` (int PK), `date_of_birth` (date), `last_login_time` (time)

### Field Constraints (18 total, match SQL exactly)

- name: min_length=1, max_length=150
- sku: pattern=`^[A-Z]{2}-\d{4}$`
- price: gt=0
- sale_price: ge=0
- weight: ge=0, lt=1000
- quantity: ge=0
- min_order_quantity: ge=1
- max_order_quantity: le=1000
- discount_percent: ge=0, le=100, multiple_of=5
- discount_amount: ge=0
- customer_name: min_length=1, max_length=100
- phone: min_length=7, max_length=15

### Field Validators (8 total, match SQL exactly)

- name: Trim (pos 0), Normalize Whitespace (pos 1)
- sku: Normalize Case upper (pos 0)
- price: Round Decimal 2 places (pos 0)
- weight: Clamp to Range 0-1000 (pos 0)
- customer_name: Trim (pos 0), Normalize Case title (pos 1), Trim To Length 100 (pos 2)

### Model Validators (5 total, match SQL exactly)

- Product: Field Comparison (min_order_quantity < max_order_quantity)
- Product: Mutual Exclusivity (discount_percent, discount_amount)
- Product: All Or None (sale_price, sale_end_date)
- Product: Conditional Required (discount_percent → sale_price)
- Customer: At Least One Required (email, phone)

### Endpoints (9 total — 7 from SQL + 2 new)

Existing in SQL:
1. `GET /products` — list, response=Product, shape=list
2. `GET /products/{tracking_id}` — get by UUID, response=Product, shape=object
3. `POST /products` — create, request=Product, response=Product
4. `PUT /items/{tracking_id}` — update, request=Product, response=Product
5. `DELETE /products/{tracking_id}` — delete, no response body
6. `GET /customers` — list, response=Customer, shape=list
7. `PATCH /customers/{email}` — update, request=Customer, response=Customer

**New (add to both SQL and YAML):**
8. `POST /customers` — create, request=Customer, response=Customer
9. `GET /customers/{email}` — get by email, response=Customer, shape=object

### Files Modified

- `tests/specs/shop_api.yaml` — full rewrite
- `docs/seed-shop-api.sql` — add 2 new endpoint INSERT statements

---

## 3. Fix Stale References in readme.mako

The `readme.mako` template still references `seed.py` and `make db-seed` which were removed in commit `4707fe2`. Remove these stale references.

### Files Modified

- `src/api_craft/templates/readme.mako` — remove seed.py/db-seed references

---

## 4. E2E Test Suite

### File

`tests/test_api_craft/test_e2e_generated.py`

### Marker

`@pytest.mark.e2e` — excluded from `make test`, run via `make test-e2e`.

### Fixture: `generated_shop_api` (session-scoped)

```
1. generate_fastapi(load_input("shop_api.yaml"), tmp_dir)
2. Overwrite .env with DB_PORT=5434, APP_PORT=8002
3. docker compose up -d --build
4. Poll http://localhost:8002/openapi.json with retries (60s timeout)
5. yield base_url ("http://localhost:8002")
6. Teardown: docker compose down -v, remove tmp_dir
```

The fixture overwrites the generated `.env` (which has default ports) with test-specific ports to avoid conflicts with any manually-running instance.

### Test Class: `TestGeneratedShopApi`

All tests use `httpx` (sync client) against `http://localhost:8002`.
Tests are ordered and share state (created entity IDs) via class variables.

**CRUD Round-Trip — Products:**

| # | Test | Method | Path | Expects |
|---|------|--------|------|---------|
| 1 | Create product | POST | /products | 201, response has all fields, tracking_id is UUID |
| 2 | List products | GET | /products | 200, list contains created product |
| 3 | Get product by ID | GET | /products/{tracking_id} | 200, fields match POST response |
| 4 | Update product | PUT | /items/{tracking_id} | 200, updated fields returned |
| 5 | Delete product | DELETE | /products/{tracking_id} | 200 or 204 |
| 6 | Get deleted product | GET | /products/{tracking_id} | 404 |

**CRUD Round-Trip — Customers:**

| # | Test | Method | Path | Expects |
|---|------|--------|------|---------|
| 7 | Create customer | POST | /customers | 201, response has all fields, customer_id is int |
| 8 | List customers | GET | /customers | 200, list contains customer |
| 9 | Get customer by email | GET | /customers/{email} | 200, fields match POST response |
| 10 | Update customer | PATCH | /customers/{email} | 200, updated fields returned |
| 11 | Get updated customer | GET | /customers/{email} | 200, fields match PATCH response |

**Constraint Violation Checks (each expects 422):**

All constraint tests POST to `/products` or `/customers` with a single invalid field (all other fields valid).

| # | Field | Constraint | Invalid Input |
|---|-------|-----------|---------------|
| 12 | name | min_length=1 | `""` |
| 13 | name | max_length=150 | 151-char string |
| 14 | sku | pattern `^[A-Z]{2}-\d{4}$` | `"test-01"` |
| 15 | price | gt=0 | `0` |
| 16 | sale_price | ge=0 | `-1` |
| 17 | weight | ge=0 | `-0.1` |
| 18 | weight | lt=1000 | `1000` |
| 19 | quantity | ge=0 | `-1` |
| 20 | min_order_quantity | ge=1 | `0` |
| 21 | max_order_quantity | le=1000 | `1001` |
| 22 | discount_percent | ge=0 | `-5` |
| 23 | discount_percent | le=100 | `105` |
| 24 | discount_percent | multiple_of=5 | `3` |
| 25 | discount_amount | ge=0 | `-1` |
| 26 | customer_name | min_length=1 | `""` |
| 27 | phone | min_length=7 | `"123"` |
| 28 | phone | max_length=15 | 16-char string |

**Field Validator Checks (send valid input, verify transformation in response):**

| # | Field | Validators | Input | Expected Output |
|---|-------|-----------|-------|-----------------|
| 29 | name | Trim + Normalize Whitespace | `"  hello   world  "` | `"hello world"` |
| 30 | sku | Normalize Case (upper) | `"ab-1234"` | `"AB-1234"` |
| 31 | price | Round Decimal (2) | `9.999` | `10.0` |
| 32 | weight | Clamp to Range (0-1000) | `-5` | `0` |
| 33 | customer_name | Trim + Title + Trim To Length | `"  john doe  "` | `"John Doe"` |

Note: Weight clamp test uses `-5` (→ clamped to `0`, passes `ge=0`) instead of `1500` which would conflict with `lt=1000` constraint depending on validator ordering.

**Model Validator Checks (each expects 422):**

| # | Object | Validator | Invalid Input |
|---|--------|----------|---------------|
| 34 | Product | Field Comparison | min_order_quantity=10, max_order_quantity=5 |
| 35 | Product | Mutual Exclusivity | discount_percent=10 AND discount_amount=5 |
| 36 | Product | All Or None | sale_price=10 without sale_end_date |
| 37 | Product | Conditional Required | discount_percent=10 without sale_price |
| 38 | Customer | At Least One Required | neither email nor phone |

### Infrastructure Changes

**`tests/conftest.py`:**
- Add Docker availability check (`docker compose version`)
- Skip `@pytest.mark.e2e` if Docker unavailable

**`Makefile`:**
- Add `test-e2e` target: `poetry run pytest -m e2e -v`
- Update `test` target: `poetry run pytest tests/ -v -m "not e2e"`

**`pyproject.toml`:**
- Register `e2e` marker in `[tool.pytest.ini_options]`

---

## Implementation Plan Structure (for parallel agents)

**Independent tasks (can run in parallel in worktrees):**
- Task A: Centralized port config (template.py, transformers.py, all .mako templates, renderers.py, main.py)
- Task B: Sync shop_api.yaml to seed SQL + add 2 new endpoints to SQL
- Task C: Test infrastructure (conftest.py, Makefile, pyproject.toml marker)

**Dependent task (requires A + B + C merged):**
- Task D: E2E test file (test_e2e_generated.py)

**Verification (requires D):**
- Task E: Run `make test` (no regressions) + `make test-e2e` (E2E passes)

Each parallel task runs in its own worktree with independent verification. Task D merges results and builds on top.

---

## Known Design Issues

**Weight clamp + lt=1000 interaction:** The seed SQL defines both `weight: lt=1000` (Pydantic constraint) and a Clamp to Range 0-1000 field validator. If the clamp runs before constraints (mode="before"), clamping 1500→1000 still fails lt=1000. If constraints run first, values ≥1000 are rejected before clamping. The clamp validator is only effective for negative values (clamped to 0, passes ge=0). This is a design quirk inherited from the seed SQL — documented here, not fixed.
