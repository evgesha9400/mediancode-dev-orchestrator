# E2E Generated API Testing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated E2E test that generates a ShopApi from YAML, starts it with Docker Compose, and validates every endpoint — catching runtime bugs that unit tests miss.

**Architecture:** Three independent tasks (port config, YAML sync, test infra) execute in parallel worktrees, then merge for the E2E test file which depends on all three. The generated project uses `.env` for centralized port config, Docker Compose for orchestration, and httpx for HTTP assertions.

**Tech Stack:** pytest, httpx, Docker Compose, Mako templates, api_craft generation pipeline

**Spec:** `docs/superpowers/specs/2026-03-11-e2e-generated-api-testing-design.md`

---

## Chunk 1: Task A — Centralized Port Configuration

**Parallel-safe:** Yes. Touches only `src/api_craft/` files and their corresponding tests in `tests/test_api_craft/test_db_codegen.py`. No overlap with Tasks B or C.

**Branch:** `feat/centralized-port-config`

### Task A.1: Add port fields to template models

**Files:**
- Modify: `src/api_craft/models/template.py:129-151`

- [ ] **Step 1: Add `db_port` to `TemplateDatabaseConfig`**

```python
# src/api_craft/models/template.py, lines 129-134
# BEFORE:
class TemplateDatabaseConfig(BaseModel):
    """Database configuration for template rendering."""

    enabled: bool
    default_url: str

# AFTER:
class TemplateDatabaseConfig(BaseModel):
    """Database configuration for template rendering."""

    enabled: bool
    default_url: str
    db_port: int = 5433
```

- [ ] **Step 2: Add `app_port` to `TemplateAPI`**

```python
# src/api_craft/models/template.py, lines 136-151
# BEFORE:
class TemplateAPI(BaseModel):
    """Root API definition for template rendering."""

    snake_name: str
    camel_name: str
    kebab_name: str
    spaced_name: str
    version: str
    author: str
    description: str
    models: list[TemplateModel]
    views: list[TemplateView]
    tags: list[TemplateTag] = []
    config: TemplateAPIConfig
    orm_models: list[TemplateORMModel] = []
    database_config: TemplateDatabaseConfig | None = None

# AFTER:
class TemplateAPI(BaseModel):
    """Root API definition for template rendering."""

    snake_name: str
    camel_name: str
    kebab_name: str
    spaced_name: str
    version: str
    author: str
    description: str
    app_port: int = 8001
    models: list[TemplateModel]
    views: list[TemplateView]
    tags: list[TemplateTag] = []
    config: TemplateAPIConfig
    orm_models: list[TemplateORMModel] = []
    database_config: TemplateDatabaseConfig | None = None
```

- [ ] **Step 3: Run tests**

Run: `poetry run pytest tests/test_api_craft/ -v --tb=short`
Expected: All pass (new fields have defaults, backward compatible)

### Task A.2: Use port fields in transformer

**Files:**
- Modify: `src/api_craft/transformers.py:349-355`

- [ ] **Step 1: Pass `db_port` to `TemplateDatabaseConfig`**

```python
# src/api_craft/transformers.py, lines 349-355
# BEFORE:
    if input_api.config.database.enabled:
        orm_models = transform_orm_models(input_api.objects)
        snake_name = camel_to_snake(input_api.name)
        database_config = TemplateDatabaseConfig(
            enabled=True,
            default_url=f"postgresql+asyncpg://postgres:postgres@localhost:5433/{snake_name}",
        )

# AFTER:
    if input_api.config.database.enabled:
        orm_models = transform_orm_models(input_api.objects)
        snake_name = camel_to_snake(input_api.name)
        db_port = 5433
        database_config = TemplateDatabaseConfig(
            enabled=True,
            default_url=f"postgresql+asyncpg://postgres:postgres@localhost:{db_port}/{snake_name}",
            db_port=db_port,
        )
```

- [ ] **Step 2: Run tests**

Run: `poetry run pytest tests/test_api_craft/test_transformers.py -v --tb=short`
Expected: All pass

### Task A.3: Create `.env` template

**Files:**
- Create: `src/api_craft/templates/env.mako`

- [ ] **Step 1: Write the template**

```mako
<%doc>
- Template Parameters:
- api: TemplateAPI
</%doc>\
DB_PORT=${api.database_config.db_port}
APP_PORT=${api.app_port}
```

### Task A.4: Update `docker_compose.mako` to use env vars

**Files:**
- Modify: `src/api_craft/templates/docker_compose.mako`

In Mako, `$$` produces a literal `$` in output. So `$${DB_PORT:-${api.database_config.db_port}}` produces `${DB_PORT:-5433}` — Docker Compose env var syntax.

- [ ] **Step 1: Replace hardcoded ports with env var interpolation**

```mako
<%doc>
- Template Parameters:
- api: TemplateAPI
</%doc>\
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${api.snake_name}
    ports:
      - "$${DB_PORT:-${api.database_config.db_port}}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build: .
    ports:
      - "$${APP_PORT:-${api.app_port}}:80"
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@db:5432/${api.snake_name}
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

Note: `DATABASE_URL` stays as `db:5432` (internal Docker network, no host port needed).

### Task A.5: Update `makefile.mako` to use env vars

**Files:**
- Modify: `src/api_craft/templates/makefile.mako`

- [ ] **Step 1: Rewrite with `-include .env` and variable defaults**

```mako
<%doc>
- Template Parameters:
- api: TemplateApi
</%doc>\
-include .env
export

% if api.database_config:
.PHONY: install run-local build clean run-container swagger db-up db-down db-init db-upgrade db-downgrade db-reset run-stack
% else:
.PHONY: install run-local build clean run-container swagger
% endif

PROJECT_NAME=${api.snake_name}
APP_PORT ?= ${api.app_port}
% if api.database_config:
DB_PORT ?= ${api.database_config.db_port}
% endif

install:
	@poetry install

% if api.database_config:
run-local: install db-up
% else:
run-local: install
% endif
	@PYTHONPATH=src poetry run uvicorn main:app --reload --port $(APP_PORT)

build:
	@docker build -t $(PROJECT_NAME) .

clean:
	-@docker stop $(PROJECT_NAME) 2>/dev/null || true
	-@docker rm $(PROJECT_NAME) 2>/dev/null || true
	-@docker rmi $(PROJECT_NAME) 2>/dev/null || true

run-container: install clean build
	@docker run --name $(PROJECT_NAME) -p $(APP_PORT):80 -d $(PROJECT_NAME):latest

swagger: install
	@PYTHONPATH=src poetry run python swagger.py
% if api.database_config:

db-up:
	@docker compose up -d db
	@echo "Waiting for PostgreSQL..."
	@sleep 2

db-down:
	@docker compose down

db-init: db-up
	@PYTHONPATH=src poetry run alembic revision --autogenerate -m "initial"

db-upgrade: db-up
	@PYTHONPATH=src poetry run alembic upgrade head

db-downgrade:
	@PYTHONPATH=src poetry run alembic downgrade -1

db-reset: db-down db-up
	@PYTHONPATH=src poetry run alembic upgrade head

run-stack:
	@docker compose up --build
% endif
```

**Mako vs Make syntax:** Mako intercepts `${expr}` (braces) but NOT `$(VAR)` (parentheses). So Make's `$(APP_PORT)` passes through Mako unchanged — no escaping needed. Only `${api.snake_name}` is a Mako expression (renders at generation time).

### Task A.6: Update `alembic_ini.mako` to use `db_port`

**Files:**
- Modify: `src/api_craft/templates/alembic_ini.mako:7`

- [ ] **Step 1: Replace hardcoded port with template variable**

```
# Line 7 BEFORE:
sqlalchemy.url = postgresql+asyncpg://postgres:postgres@localhost:5433/${api.snake_name}

# Line 7 AFTER:
sqlalchemy.url = postgresql+asyncpg://postgres:postgres@localhost:${api.database_config.db_port}/${api.snake_name}
```

### Task A.7: Update `readme.mako` — use `app_port`, remove stale seed refs, document `.env`

**Files:**
- Modify: `src/api_craft/templates/readme.mako`

- [ ] **Step 1: Replace all hardcoded `8001` with `${api.app_port}`**

Lines 57, 65, 102, 103, 104 — replace `8001` with `${api.app_port}`.

- [ ] **Step 2: Remove stale seed references**

Remove line 84-85 (`make db-seed`), line 123 (`seed.py`), line 153 (`make db-seed` in commands table).

- [ ] **Step 3: Add `.env` to project structure and document port config**

In the project structure section, add `.env` file. Add a "Configuration" section documenting `.env` port overrides.

After the Database Setup section, add (wrapped in a DB guard since `db_port` is only available when DB is enabled):

```mako
% if api.database_config:
${"###"} Port Configuration

Default ports are configured in `.env`:

${"```"}
DB_PORT=${api.database_config.db_port}
APP_PORT=${api.app_port}
${"```"}

Change these values to avoid conflicts with other services.
% endif
```

### Task A.8: Add `render_env` and wire up in pipeline

**Files:**
- Modify: `src/api_craft/renderers.py` — add render function
- Modify: `src/api_craft/main.py:102-117` — load env template
- Modify: `src/api_craft/main.py:234-251` — render env file
- Modify: `src/api_craft/main.py:276-284` — add `.env` to root files

- [ ] **Step 1: Add render function to `renderers.py`**

After `render_alembic_env` (line 111), add:

```python
def render_env(api: TemplateAPI, template: Template) -> str:
    return template.render(api=api)
```

- [ ] **Step 2: Load env template in `main.py`**

In `load_templates()`, add to `template_files` dict (after line 116):

```python
"env": "env.mako",
```

- [ ] **Step 3: Render env file in `render_components()`**

In the database files block (after line 251, inside `if database_config and orm_models:`):

```python
rendered_components[".env"] = render_env(
    template_api, self.templates["env"]
)
```

Add `render_env` to the import from `api_craft.renderers` at the top of `main.py`.

- [ ] **Step 4: Add `.env` to root files set**

In `write_files()`, add `.env` to the `root_files` set (line 277-284):

```python
root_files = {
    "pyproject.toml",
    "Makefile",
    "Dockerfile",
    "README.md",
    "docker-compose.yml",
    "alembic.ini",
    ".env",
}
```

### Task A.9: Update existing tests

**Files:**
- Modify: `tests/test_api_craft/test_db_codegen.py` — update any assertions on generated file content
- Modify: `tests/test_api_craft/test_shop_codegen.py:116-155` — add `.env` to expected files if DB-enabled

- [ ] **Step 1: Read `test_db_codegen.py` and `test_shop_codegen.py`**

Check for assertions that verify:
- Port numbers in generated docker-compose.yml, Makefile, alembic.ini
- File existence lists (`.env` is new)
- Generated README content (seed references removed)

Update assertions to match new behavior. Specifically:
- Add `.env` to expected generated files in any file-existence checks
- Assert `.env` contains `DB_PORT=5433` and `APP_PORT=8001` (defaults)
- Assert `docker-compose.yml` contains `${DB_PORT:-5433}` and `${APP_PORT:-8001}` env var syntax
- Assert `Makefile` contains `-include .env` and `APP_PORT ?=`

- [ ] **Step 2: Run all tests**

Run: `poetry run pytest tests/ -v --tb=short`
Expected: All pass

- [ ] **Step 3: Format and commit**

```bash
poetry run black src/ tests/
git add -A
git commit -m "feat(generation): centralize port configuration via .env file

- Add db_port to TemplateDatabaseConfig, app_port to TemplateAPI
- Generate .env file with DB_PORT and APP_PORT defaults
- docker-compose.yml uses env var interpolation for port overrides
- Makefile sources .env with -include for seamless port config
- alembic_ini.mako uses db_port from template config
- readme.mako uses app_port, removes stale seed.py references
- All hardcoded port values replaced with template variables"
```

---

## Chunk 2: Task B — Sync shop_api.yaml to Seed SQL

**Parallel-safe:** Yes. Touches only `tests/specs/shop_api.yaml`, `docs/seed-shop-api.sql`, and `tests/test_api_craft/test_shop_codegen.py`. No overlap with Tasks A or C.

**Branch:** `feat/sync-shop-yaml-to-sql`

### Task B.1: Rewrite `shop_api.yaml`

**Files:**
- Rewrite: `tests/specs/shop_api.yaml`

**Source of truth:** `docs/seed-shop-api.sql`

- [ ] **Step 1: Read `docs/seed-shop-api.sql` completely and `src/api_craft/models/input.py`**

Understand the exact SQL structure and the InputAPI model schema.

- [ ] **Step 2: Write the new YAML**

The YAML must match the SQL exactly, with these additions:
- `config.database.enabled: true`
- `config.response_placeholders: false`
- `pk: true` on `tracking_id` (Product) and `customer_id` (Customer)
- `use_envelope: false` on ALL endpoints
- 2 new endpoints not in SQL: `POST /customers` and `GET /customers/{email}`

**Structure:**

```yaml
name: ShopApi
version: "1.0.0"
author: Median Code
description: Complete online shop API

tags:
  - name: Products
  - name: Customers

objects:
  - name: Product
    description: Shop product
    fields: # 16 fields from SQL lines 183-198, in SQL order
      - name: name
        type: str
        validators:
          - name: min_length
            params: { value: 1 }
          - name: max_length
            params: { value: 150 }
        field_validators:
          - function_name: trim_name
            mode: before
            function_body: "        v = v.strip()\n        return v"
          - function_name: normalize_whitespace_name
            mode: before
            function_body: "        import re\n        v = re.sub(r'\\s+', ' ', v).strip()\n        return v"
      - name: sku
        type: str
        validators:
          - name: pattern
            params: { value: "^[A-Z]{2}-\\d{4}$" }
        field_validators:
          - function_name: normalize_case_sku
            mode: before
            function_body: "        v = v.upper()\n        return v"
      - name: price
        type: decimal.Decimal
        validators:
          - name: gt
            params: { value: 0 }
        field_validators:
          - function_name: round_decimal_price
            mode: after
            function_body: "        v = round(v, 2)\n        return v"
      - name: sale_price
        type: decimal.Decimal
        optional: true
        validators:
          - name: ge
            params: { value: 0 }
      - name: sale_end_date
        type: datetime.date
        optional: true
      - name: weight
        type: float
        validators:
          - name: ge
            params: { value: 0 }
          - name: lt
            params: { value: 1000 }
        field_validators:
          - function_name: clamp_weight
            mode: before
            function_body: "        v = max(0, min(float(v), 1000))\n        return v"
      - name: quantity
        type: int
        validators:
          - name: ge
            params: { value: 0 }
      - name: min_order_quantity
        type: int
        validators:
          - name: ge
            params: { value: 1 }
      - name: max_order_quantity
        type: int
        optional: true
        validators:
          - name: le
            params: { value: 1000 }
      - name: discount_percent
        type: int
        optional: true
        validators:
          - name: ge
            params: { value: 0 }
          - name: le
            params: { value: 100 }
          - name: multiple_of
            params: { value: 5 }
      - name: discount_amount
        type: decimal.Decimal
        optional: true
        validators:
          - name: ge
            params: { value: 0 }
      - name: in_stock
        type: bool
      - name: product_url
        type: HttpUrl
      - name: release_date
        type: datetime.date
      - name: created_at
        type: datetime.datetime
      - name: tracking_id
        type: uuid.UUID.UUID
        pk: true
    model_validators:
      - function_name: validate_order_quantity_range
        mode: after
        function_body: "        if self.max_order_quantity is not None and self.min_order_quantity >= self.max_order_quantity:\n            raise ValueError('min_order_quantity must be less than max_order_quantity')\n        return self"
      - function_name: validate_discount_exclusivity
        mode: after
        function_body: "        if self.discount_percent is not None and self.discount_amount is not None:\n            raise ValueError('Cannot have both discount_percent and discount_amount')\n        return self"
      - function_name: validate_sale_fields
        mode: after
        function_body: "        sale_fields = [self.sale_price, self.sale_end_date]\n        filled = [f for f in sale_fields if f is not None]\n        if 0 < len(filled) < len(sale_fields):\n            raise ValueError('All or none of sale fields (sale_price, sale_end_date) must be provided')\n        return self"
      - function_name: validate_discount_requires_sale
        mode: after
        function_body: "        if self.discount_percent is not None and self.sale_price is None:\n            raise ValueError('discount_percent requires sale_price to be set')\n        return self"

  - name: Customer
    description: Shop customer
    fields: # 8 fields from SQL lines 200-207, in SQL order
      - name: customer_id
        type: int
        pk: true
      - name: customer_name
        type: str
        validators:
          - name: min_length
            params: { value: 1 }
          - name: max_length
            params: { value: 100 }
        field_validators:
          - function_name: trim_customer_name
            mode: before
            function_body: "        v = v.strip()\n        return v"
          - function_name: normalize_case_customer_name
            mode: before
            function_body: "        v = v.title()\n        return v"
          - function_name: trim_to_length_customer_name
            mode: after
            function_body: "        v = v[:100]\n        return v"
      - name: email
        type: EmailStr
        optional: true
      - name: phone
        type: str
        optional: true
        validators:
          - name: min_length
            params: { value: 7 }
          - name: max_length
            params: { value: 15 }
      - name: date_of_birth
        type: datetime.date
      - name: last_login_time
        type: datetime.time
      - name: is_active
        type: bool
      - name: registered_at
        type: datetime.datetime
    model_validators:
      - function_name: validate_contact_required
        mode: after
        function_body: "        if self.email is None and self.phone is None:\n            raise ValueError('At least one of email or phone must be provided')\n        return self"

endpoints:
  # Products (5 endpoints from SQL + existing)
  - name: ListProducts
    path: /products
    method: GET
    response: Product
    tag: Products
    description: List all products
    use_envelope: false
    response_shape: list

  - name: GetProduct
    path: /products/{tracking_id}
    method: GET
    response: Product
    tag: Products
    description: Get product by tracking ID
    use_envelope: false
    response_shape: object
    path_params:
      - name: tracking_id
        type: uuid.UUID.UUID

  - name: CreateProduct
    path: /products
    method: POST
    request: Product
    response: Product
    tag: Products
    description: Create a product
    use_envelope: false
    response_shape: object

  - name: UpdateProduct
    path: /items/{tracking_id}
    method: PUT
    request: Product
    response: Product
    tag: Products
    description: Update a product
    use_envelope: false
    response_shape: object
    path_params:
      - name: tracking_id
        type: uuid.UUID

  - name: DeleteProduct
    path: /products/{tracking_id}
    method: DELETE
    tag: Products
    description: Delete a product
    use_envelope: false
    response_shape: object
    path_params:
      - name: tracking_id
        type: uuid.UUID

  # Customers (4 endpoints: 2 from SQL + 2 new)
  - name: ListCustomers
    path: /customers
    method: GET
    response: Customer
    tag: Customers
    description: List all customers
    use_envelope: false
    response_shape: list

  - name: CreateCustomer
    path: /customers
    method: POST
    request: Customer
    response: Customer
    tag: Customers
    description: Create a customer
    use_envelope: false
    response_shape: object

  - name: GetCustomer
    path: /customers/{email}
    method: GET
    response: Customer
    tag: Customers
    description: Get customer by email
    use_envelope: false
    response_shape: object
    path_params:
      - name: email
        type: EmailStr

  - name: UpdateCustomer
    path: /customers/{email}
    method: PATCH
    request: Customer
    response: Customer
    tag: Customers
    description: Update a customer by email
    use_envelope: false
    response_shape: object
    path_params:
      - name: email
        type: EmailStr

config:
  healthcheck: /healthcheck
  response_placeholders: false
  database:
    enabled: true
```

**IMPORTANT:** The YAML uses `function_name`/`mode`/`function_body` format for both `field_validators` and `model_validators`, matching the `InputResolvedFieldValidator` and `InputResolvedModelValidator` schemas. The `function_body` contains actual Python code with proper indentation (8 spaces). Types use qualified forms (`decimal.Decimal`, `datetime.date`, `datetime.time`, `datetime.datetime`, `uuid.UUID`) matching the existing YAML conventions.

### Task B.2: Add 2 new endpoints to seed SQL

**Files:**
- Modify: `docs/seed-shop-api.sql:259-321`

- [ ] **Step 1: Add `POST /customers` and `GET /customers/{email}` endpoints**

Insert after line 321 (before `COMMIT`), add two more endpoint VALUES to the existing INSERT statement. Reference the SQL's existing pattern for endpoint structure.

```sql
  -- POST /customers
  (gen_random_uuid(), (SELECT id FROM a), 'POST', '/customers',
   'Create a customer', 'Customers', '[]',
   (SELECT id FROM customer_id), (SELECT id FROM customer_id), false, 'object'),

  -- GET /customers/{email}
  (gen_random_uuid(), (SELECT id FROM a), 'GET', '/customers/{email}',
   'Get customer by email', 'Customers',
   (SELECT json_build_array(json_build_object('name', 'email', 'fieldId', id::text))::jsonb FROM email_id),
   NULL, (SELECT id FROM customer_id), false, 'object')
```

**Note:** These are added as additional VALUES rows in the existing INSERT INTO `api_endpoints` statement. The current last row (PATCH /customers/{email}) needs a comma added after it. The new GET /customers/{email} is the final row (no trailing comma).

### Task B.3: Update `test_shop_codegen.py`

**Files:**
- Modify: `tests/test_api_craft/test_shop_codegen.py`

The test has hardcoded counts and field references that must match the new YAML.

- [ ] **Step 1: Read the full test file and update assertions**

Key changes needed:
- `test_input_api_dump` (line 75-99): Update object count (6→2), endpoint count (7→9), Product field count (17→16), Customer field count (7→8), Customer now has 1 model validator
- `test_template_api_dump` (line 101-114): Update model count (6→2), view count (7→9)
- `test_generated_files` (line 116-155): If `database.enabled=true`, add DB files to expected list (`.env`, `docker-compose.yml`, `alembic.ini`, `orm_models.py`, `database.py`, `migrations/`)
- `TestShopApiEndpoints`: Update test payloads and endpoint paths to match new schema:
  - Product payloads need new required fields: `weight`, `in_stock`, `product_url`, `release_date`, `tracking_id` (or omit PK if auto-generated)
  - Remove `is_active`, `cost`, `website_url` references
  - `test_list_products`: No longer checks for envelope (`products`/`total` keys) — response is now a plain list
  - `test_list_customers`: Same — plain list, not envelope
  - Add tests for new endpoints: `POST /customers`, `GET /customers/{email}`
- `TestProductConstraints._valid_product`: Update base payload to include all new required fields
- `TestProductModelValidators._valid_product`: Same
- Model validator tests: Update to use new field names (e.g., `discount_amount` instead of `is_on_sale`, `sale_end_date` instead of `sale_start`)

- [ ] **Step 2: Run tests**

Run: `poetry run pytest tests/test_api_craft/test_shop_codegen.py -v --tb=short`
Expected: All pass

- [ ] **Step 3: Format and commit**

```bash
poetry run black src/ tests/
git add tests/specs/shop_api.yaml docs/seed-shop-api.sql tests/test_api_craft/test_shop_codegen.py
git commit -m "feat(generation): sync shop_api.yaml to seed SQL and add customer endpoints

- Rewrite shop_api.yaml to match docs/seed-shop-api.sql exactly
- Consolidate from 6 objects to 2 (Product, Customer)
- Add database.enabled, response_placeholders: false, pk markers
- Set use_envelope: false on all endpoints
- Add POST /customers and GET /customers/{email} endpoints
- Add same 2 endpoints to seed SQL
- Update test_shop_codegen.py assertions for new structure"
```

---

## Chunk 3: Task C + Task D — Test Infrastructure & E2E Test

**Task C is parallel-safe:** Touches `tests/conftest.py`, root `Makefile`, root `pyproject.toml`. No overlap with A or B.

**Task D depends on A + B + C merged.** Must run after all three are merged to develop.

**Branch (C):** `feat/e2e-test-infra`
**Branch (D):** `feat/e2e-generated-test` (created after merging A+B+C)

### Task C.1: Register `e2e` marker in pyproject.toml

**Files:**
- Modify: `pyproject.toml:56-62`

- [ ] **Step 1: Add e2e marker**

After the existing markers (line 62), add:

```toml
    "e2e: end-to-end tests that generate and run full API projects (requires Docker)",
```

### Task C.2: Add Docker availability check to conftest.py

**Files:**
- Modify: `tests/conftest.py`

- [ ] **Step 1: Add Docker check function**

After the existing `_check_database_available()` function (after line 31), add:

```python
def _check_docker_available() -> bool:
    """Check whether Docker Compose is available."""
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
```

Add `import subprocess` at the top of the file.

- [ ] **Step 2: Skip e2e tests if Docker unavailable**

In `pytest_collection_modifyitems` (around line 34-56), add a block for e2e tests:

```python
_docker_available = _check_docker_available()

# ... existing integration skip logic ...

if not _docker_available:
    skip_e2e = pytest.mark.skip(reason="Docker not available")
    for item in items:
        if "e2e" in item.keywords:
            item.add_marker(skip_e2e)
```

### Task C.3: Update Makefile test targets

**Files:**
- Modify: `Makefile` (root)

- [ ] **Step 1: Update `test` target to exclude e2e**

Note: `pyproject.toml` has `addopts = "-m 'not manual' -rs"`. Command-line `-m` overrides `addopts`, so we must combine both exclusions.

```makefile
# BEFORE:
test:
	@poetry run pytest tests/ -v

# AFTER:
test:
	@poetry run pytest tests/ -v -m "not e2e and not manual"
```

- [ ] **Step 2: Add `test-e2e` target**

After the `test` target:

```makefile
test-e2e:
	@poetry run pytest -m e2e -v
```

Add `test-e2e` to the `.PHONY` list.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml tests/conftest.py Makefile
git commit -m "feat(config): add e2e test infrastructure

- Register e2e pytest marker
- Add Docker availability check, skip e2e if unavailable
- Add make test-e2e target, exclude e2e from make test"
```

---

### Task D.1: Write E2E test file

**DEPENDS ON:** Tasks A, B, C all merged to develop.

**Files:**
- Create: `tests/test_api_craft/test_e2e_generated.py`

- [ ] **Step 1: Read the generated project structure**

Before writing the test, generate the project once manually to understand its structure:

```bash
cd /tmp && python -c "
from api_craft.main import generate_fastapi
from api_craft.models.input import InputAPI
import yaml
with open('tests/specs/shop_api.yaml') as f:
    data = yaml.safe_load(f)
api = InputAPI(**data)
generate_fastapi(api, '/tmp/test-gen')
" && find /tmp/test-gen -type f | sort
```

Examine the generated views.py to understand:
- What status codes each endpoint returns (201 for POST? 200? 204 for DELETE?)
- How path params are handled
- Whether POST creates new records or if it's placeholder-based

- [ ] **Step 2: Write the test file**

```python
# tests/test_api_craft/test_e2e_generated.py
"""End-to-end test: generate ShopApi, start with Docker Compose, validate endpoints.

This test catches runtime bugs invisible to unit tests: missing dependencies,
broken imports, port conflicts, ORM mapping errors, validator failures.
"""

import shutil
import subprocess
import time
from pathlib import Path

import httpx
import pytest
import yaml

from api_craft.main import generate_fastapi
from api_craft.models.input import InputAPI

pytestmark = pytest.mark.e2e

SPECS_DIR = Path(__file__).parent.parent / "specs"
E2E_APP_PORT = 8002
E2E_DB_PORT = 5434
BASE_URL = f"http://localhost:{E2E_APP_PORT}"
STARTUP_TIMEOUT = 120  # seconds


def _load_input(filename: str) -> InputAPI:
    with open(SPECS_DIR / filename) as f:
        data = yaml.safe_load(f)
    return InputAPI(**data)


@pytest.fixture(scope="session")
def generated_shop_api(tmp_path_factory):
    """Generate ShopApi, start with Docker Compose, yield base URL, tear down."""
    tmp_dir = tmp_path_factory.mktemp("e2e_shop")
    input_api = _load_input("shop_api.yaml")

    # 1. Generate project
    generate_fastapi(input_api, str(tmp_dir))
    project_dir = tmp_dir / "shop-api"
    assert project_dir.exists(), f"Generated project not found at {project_dir}"

    # 2. Override .env with test ports
    (project_dir / ".env").write_text(
        f"DB_PORT={E2E_DB_PORT}\nAPP_PORT={E2E_APP_PORT}\n"
    )

    # 3. Docker compose up
    try:
        subprocess.run(
            ["docker", "compose", "up", "-d", "--build"],
            cwd=str(project_dir),
            check=True,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.CalledProcessError as e:
        pytest.fail(
            f"docker compose up failed:\nstdout: {e.stdout}\nstderr: {e.stderr}"
        )

    # 4. Wait for readiness
    deadline = time.time() + STARTUP_TIMEOUT
    ready = False
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE_URL}/openapi.json", timeout=3)
            if r.status_code == 200:
                ready = True
                break
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(2)

    if not ready:
        logs = subprocess.run(
            ["docker", "compose", "logs"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
        )
        # Tear down before failing
        subprocess.run(
            ["docker", "compose", "down", "-v"],
            cwd=str(project_dir),
            capture_output=True,
        )
        pytest.fail(
            f"Generated API not ready within {STARTUP_TIMEOUT}s.\n"
            f"Logs:\n{logs.stdout}\n{logs.stderr}"
        )

    yield BASE_URL

    # 6. Teardown
    subprocess.run(
        ["docker", "compose", "down", "-v", "--remove-orphans"],
        cwd=str(project_dir),
        capture_output=True,
        timeout=60,
    )


# =============================================================================
# Valid payload builders
# =============================================================================


def valid_product(**overrides) -> dict:
    """Build a valid product payload. All required fields included."""
    base = {
        "name": "Test Widget",
        "sku": "AB-1234",
        "price": 29.99,
        "weight": 0.5,
        "quantity": 100,
        "min_order_quantity": 1,
        "in_stock": True,
        "product_url": "https://example.com/widget",
        "release_date": "2026-01-15",
        "created_at": "2026-01-01T00:00:00",
    }
    base.update(overrides)
    return base


def valid_customer(**overrides) -> dict:
    """Build a valid customer payload. All required fields included."""
    base = {
        "customer_name": "John Doe",
        "email": "john@example.com",
        "phone": "1234567890",
        "date_of_birth": "1990-05-15",
        "last_login_time": "14:30:00",
        "is_active": True,
        "registered_at": "2026-01-01T00:00:00",
    }
    base.update(overrides)
    return base


# =============================================================================
# CRUD Round-Trip Tests
# =============================================================================


class TestCrudRoundTrip:
    """CRUD operations: create, read, update, delete with data verification."""

    # Shared state across ordered tests
    product_tracking_id: str | None = None
    customer_id: int | None = None
    customer_email: str = "john@example.com"

    def test_phase_01_create_product(self, generated_shop_api):
        """POST /products — create and store tracking_id."""
        r = httpx.post(f"{generated_shop_api}/products", json=valid_product())
        assert r.status_code in (200, 201), f"Create product failed: {r.status_code} {r.text}"
        data = r.json()
        assert "tracking_id" in data
        TestCrudRoundTrip.product_tracking_id = data["tracking_id"]

    def test_phase_02_list_products(self, generated_shop_api):
        """GET /products — list contains created product."""
        r = httpx.get(f"{generated_shop_api}/products")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) >= 1
        ids = [p.get("tracking_id") for p in data]
        assert TestCrudRoundTrip.product_tracking_id in ids

    def test_phase_03_get_product(self, generated_shop_api):
        """GET /products/{tracking_id} — fields match."""
        tid = TestCrudRoundTrip.product_tracking_id
        r = httpx.get(f"{generated_shop_api}/products/{tid}")
        assert r.status_code == 200
        data = r.json()
        assert data["tracking_id"] == tid
        assert data["name"] == "Test Widget"
        assert data["sku"] == "AB-1234"

    def test_phase_04_update_product(self, generated_shop_api):
        """PUT /items/{tracking_id} — update and verify."""
        tid = TestCrudRoundTrip.product_tracking_id
        updated = valid_product(name="Updated Widget", price=39.99)
        r = httpx.put(f"{generated_shop_api}/items/{tid}", json=updated)
        assert r.status_code == 200, f"Update product failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["name"] == "Updated Widget"

    def test_phase_05_delete_product(self, generated_shop_api):
        """DELETE /products/{tracking_id}."""
        tid = TestCrudRoundTrip.product_tracking_id
        r = httpx.delete(f"{generated_shop_api}/products/{tid}")
        assert r.status_code in (200, 204), f"Delete failed: {r.status_code} {r.text}"

    def test_phase_06_get_deleted_product(self, generated_shop_api):
        """GET /products/{tracking_id} — should 404."""
        tid = TestCrudRoundTrip.product_tracking_id
        r = httpx.get(f"{generated_shop_api}/products/{tid}")
        assert r.status_code == 404

    def test_phase_07_create_customer(self, generated_shop_api):
        """POST /customers — create and store ID."""
        r = httpx.post(f"{generated_shop_api}/customers", json=valid_customer())
        assert r.status_code in (200, 201), f"Create customer failed: {r.status_code} {r.text}"
        data = r.json()
        assert "customer_id" in data
        TestCrudRoundTrip.customer_id = data["customer_id"]

    def test_phase_08_list_customers(self, generated_shop_api):
        """GET /customers — list contains created customer."""
        r = httpx.get(f"{generated_shop_api}/customers")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_phase_09_get_customer(self, generated_shop_api):
        """GET /customers/{email} — fields match."""
        email = TestCrudRoundTrip.customer_email
        r = httpx.get(f"{generated_shop_api}/customers/{email}")
        assert r.status_code == 200
        data = r.json()
        # customer_name goes through Title Case validator
        assert data["customer_name"] == "John Doe"

    def test_phase_10_update_customer(self, generated_shop_api):
        """PATCH /customers/{email} — update and verify."""
        email = TestCrudRoundTrip.customer_email
        r = httpx.patch(
            f"{generated_shop_api}/customers/{email}",
            json={"customer_name": "Jane Smith", "phone": "9876543210"},
        )
        assert r.status_code == 200, f"Update customer failed: {r.status_code} {r.text}"

    def test_phase_11_get_updated_customer(self, generated_shop_api):
        """GET /customers/{email} — verify update applied."""
        email = TestCrudRoundTrip.customer_email
        r = httpx.get(f"{generated_shop_api}/customers/{email}")
        assert r.status_code == 200
        data = r.json()
        assert data["customer_name"] == "Jane Smith"


# =============================================================================
# Constraint Violation Tests
# =============================================================================


class TestConstraintViolations:
    """Each test sends one invalid field, expects 422."""

    def _post_product(self, base_url, **overrides):
        return httpx.post(f"{base_url}/products", json=valid_product(**overrides))

    def _post_customer(self, base_url, **overrides):
        return httpx.post(f"{base_url}/customers", json=valid_customer(**overrides))

    # --- Product constraints ---

    def test_name_min_length(self, generated_shop_api):
        assert self._post_product(generated_shop_api, name="").status_code == 422

    def test_name_max_length(self, generated_shop_api):
        assert self._post_product(generated_shop_api, name="A" * 151).status_code == 422

    def test_sku_pattern(self, generated_shop_api):
        assert self._post_product(generated_shop_api, sku="test-01").status_code == 422

    def test_price_gt_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, price=0).status_code == 422

    def test_sale_price_ge_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, sale_price=-1).status_code == 422

    def test_weight_ge_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, weight=-0.1).status_code == 422

    def test_weight_lt_1000(self, generated_shop_api):
        assert self._post_product(generated_shop_api, weight=1000).status_code == 422

    def test_quantity_ge_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, quantity=-1).status_code == 422

    def test_min_order_ge_one(self, generated_shop_api):
        assert self._post_product(generated_shop_api, min_order_quantity=0).status_code == 422

    def test_max_order_le_1000(self, generated_shop_api):
        assert self._post_product(generated_shop_api, max_order_quantity=1001).status_code == 422

    def test_discount_percent_ge_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, discount_percent=-5).status_code == 422

    def test_discount_percent_le_100(self, generated_shop_api):
        assert self._post_product(generated_shop_api, discount_percent=105).status_code == 422

    def test_discount_percent_multiple_of_5(self, generated_shop_api):
        assert self._post_product(generated_shop_api, discount_percent=3).status_code == 422

    def test_discount_amount_ge_zero(self, generated_shop_api):
        assert self._post_product(generated_shop_api, discount_amount=-1).status_code == 422

    # --- Customer constraints ---

    def test_customer_name_min_length(self, generated_shop_api):
        assert self._post_customer(generated_shop_api, customer_name="").status_code == 422

    def test_phone_min_length(self, generated_shop_api):
        assert self._post_customer(generated_shop_api, phone="123").status_code == 422

    def test_phone_max_length(self, generated_shop_api):
        assert self._post_customer(generated_shop_api, phone="1" * 16).status_code == 422


# =============================================================================
# Field Validator Transformation Tests
# =============================================================================


class TestFieldValidators:
    """Send input, verify transformed output in response."""

    def test_name_trim_normalize(self, generated_shop_api):
        """Trim + Normalize Whitespace: '  hello   world  ' -> 'hello world'."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(name="  hello   world  "),
        )
        assert r.status_code in (200, 201)
        assert r.json()["name"] == "hello world"

    def test_sku_uppercase(self, generated_shop_api):
        """Normalize Case (upper): 'ab-1234' -> 'AB-1234'."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(sku="ab-1234"),
        )
        assert r.status_code in (200, 201)
        assert r.json()["sku"] == "AB-1234"

    def test_price_round_decimal(self, generated_shop_api):
        """Round Decimal (2 places): 9.999 -> 10.0."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(price=9.999),
        )
        assert r.status_code in (200, 201)
        assert float(r.json()["price"]) == 10.0

    def test_weight_clamp_negative(self, generated_shop_api):
        """Clamp to Range (0-1000): -5 -> 0."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(weight=-5),
        )
        # Depends on validator ordering: if clamp runs before constraint,
        # -5 is clamped to 0 (passes ge=0). If constraint runs first, 422.
        if r.status_code in (200, 201):
            assert float(r.json()["weight"]) == 0.0
        else:
            assert r.status_code == 422

    def test_customer_name_trim_title(self, generated_shop_api):
        """Trim + Title Case + Trim To Length: '  john doe  ' -> 'John Doe'."""
        r = httpx.post(
            f"{generated_shop_api}/customers",
            json=valid_customer(customer_name="  john doe  "),
        )
        assert r.status_code in (200, 201)
        assert r.json()["customer_name"] == "John Doe"


# =============================================================================
# Model Validator Tests
# =============================================================================


class TestModelValidators:
    """Each test sends an invalid combination, expects 422."""

    def test_field_comparison_rejects(self, generated_shop_api):
        """min_order_quantity > max_order_quantity is rejected."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(min_order_quantity=10, max_order_quantity=5),
        )
        assert r.status_code == 422

    def test_mutual_exclusivity_rejects(self, generated_shop_api):
        """Both discount_percent and discount_amount is rejected."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(discount_percent=10, discount_amount=5),
        )
        assert r.status_code == 422

    def test_all_or_none_rejects_partial(self, generated_shop_api):
        """sale_price without sale_end_date is rejected."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(sale_price=10),
        )
        assert r.status_code == 422

    def test_conditional_required_rejects(self, generated_shop_api):
        """discount_percent without sale_price is rejected."""
        r = httpx.post(
            f"{generated_shop_api}/products",
            json=valid_product(discount_percent=10),
        )
        assert r.status_code == 422

    def test_at_least_one_required_rejects(self, generated_shop_api):
        """Customer with neither email nor phone is rejected."""
        r = httpx.post(
            f"{generated_shop_api}/customers",
            json=valid_customer(email=None, phone=None),
        )
        assert r.status_code == 422
```

### Task D.2: Run and verify

- [ ] **Step 1: Run unit tests (no regressions)**

Run: `poetry run pytest tests/ -v -m "not e2e" --tb=short`
Expected: All pass

- [ ] **Step 2: Run E2E test**

Run: `poetry run pytest -m e2e -v --tb=long`
Expected: All pass. If failures occur, debug by:
1. Reading the generated project's docker compose logs
2. Checking the generated source files
3. Fixing either the templates (Task A), the YAML (Task B), or the test assertions (Task D)

- [ ] **Step 3: Format and commit**

```bash
poetry run black src/ tests/
git add tests/test_api_craft/test_e2e_generated.py
git commit -m "feat(generation): add E2E test for generated ShopApi

- Generate ShopApi from YAML, start via Docker Compose, validate all endpoints
- CRUD round-trip: create, list, get, update, delete for Products and Customers
- Constraint violation checks for all 17 field constraints
- Field validator transformation checks (trim, normalize, clamp, round)
- Model validator checks (field comparison, mutual exclusivity, all-or-none)
- Uses isolated ports (5434/8002) to avoid conflicts with running instances"
```

---

## Execution Order

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Task A     │  │   Task B     │  │   Task C     │
│  Port Config │  │  YAML Sync   │  │  Test Infra  │
│  (worktree)  │  │  (worktree)  │  │  (worktree)  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    Merge to develop
                         │
                  ┌──────┴───────┐
                  │   Task D     │
                  │  E2E Test    │
                  │  (develop)   │
                  └──────┬───────┘
                         │
                  ┌──────┴───────┐
                  │   Verify     │
                  │  make test   │
                  │  make test-e2e│
                  └──────────────┘
```

**Parallel agent assignment:**
- Agent 1: Task A (worktree, `feat/centralized-port-config`)
- Agent 2: Task B (worktree, `feat/sync-shop-yaml-to-sql`)
- Agent 3: Task C (worktree, `feat/e2e-test-infra`)
- After merge: Agent 4: Task D (on develop, `feat/e2e-generated-test`)

**Independent verification per agent:**
- Agent 1: `poetry run pytest tests/test_api_craft/ -v --tb=short` (all pass)
- Agent 2: `poetry run pytest tests/test_api_craft/test_shop_codegen.py -v --tb=short` (all pass)
- Agent 3: `poetry run pytest tests/ -v --tb=short` (all pass, e2e skipped without Docker)
- Agent 4: `make test && make test-e2e` (everything passes)
