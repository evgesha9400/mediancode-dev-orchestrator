# Shop API Seed Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drifting SQL seed file, test_generation script, and duplicated E2E test data with a single importable seed module that creates the Shop API via REST API calls.

**Architecture:** A `src/api/seeding/` package with pure data definitions (`shop_data.py`), an auth-agnostic runner (`runner.py`) that accepts any `httpx.AsyncClient`, a Clerk JWT helper (`clerk_auth.py`), and a CLI entrypoint (`__main__.py`). The runner resolves symbolic names to UUIDs at runtime by querying read-only catalogues.

**Tech Stack:** Python 3.13, httpx, argparse, Clerk Backend API (httpx calls, no SDK)

**Spec:** `docs/work/shop-seed-module/spec.md`

**Working directory:** `backend/` (all paths below are relative to the backend repo root)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/seeding/__init__.py` | Create | Re-export `seed_shop`, `clean_shop`, `SeedResult`, `SeedError` |
| `src/api/seeding/shop_data.py` | Create | Canonical Shop seed data — 24 fields, 2 objects, 1 relationship, 1 API, 9 endpoints |
| `src/api/seeding/runner.py` | Create | Catalogue resolution, `seed_shop()`, `clean_shop()`, `SeedError`, `SeedResult` |
| `src/api/seeding/clerk_auth.py` | Create | `mint_clerk_jwt()` — find Clerk user, get session, mint token |
| `src/api/seeding/__main__.py` | Create | CLI: argparse, mode dispatch, client construction |
| `tests/test_api/test_seeding.py` | Create | Integration test for seed_shop + clean_shop via ASGI transport |
| `tests/test_api/test_e2e_shop_full.py` | Modify | Import shared defs from `shop_data`, add missing endpoints/relationship/appears |
| `scripts/test_generation.py` | Delete | Replaced by `python -m api.seeding` |
| `docs/seed-shop-api.sql` | Delete | Replaced by `shop_data.py` |

---

## Task 1: Canonical Seed Data (`shop_data.py`)

**Files:**
- Create: `src/api/seeding/__init__.py`
- Create: `src/api/seeding/shop_data.py`

- [ ] **Step 1: Create the package with empty init**

Create `src/api/seeding/__init__.py`:
```python
"""Shop API seeding module."""
```

- [ ] **Step 2: Write shop_data.py with field definitions**

Create `src/api/seeding/shop_data.py` with all 24 field definitions. Each field is a dict with `name`, `type`, `constraints` (list of `(constraint_name, value)` tuples), and `validators` (list of `(template_name, params_or_None)` tuples).

Reference the existing pattern from `tests/test_api/test_e2e_shop_full.py:102-250` — the field definitions there are nearly identical, except:
- `name` field: use `max_length=150` (final state, not 200)
- `customer_name` field: include all 3 validators (Trim, Normalize Case title, Trim To Length 100)
- Keep `customer_id` field (int, no constraints, no validators)

Structure:
```python
"""Canonical Shop API seed data — single source of truth.

All references use symbolic names (e.g., type="str", constraint="min_length").
The runner resolves these to UUIDs at runtime from read-only catalogues.
"""

PRODUCT_FIELDS = [
    {
        "name": "name",
        "type": "str",
        "constraints": [("min_length", "1"), ("max_length", "150")],
        "validators": [("Trim", None), ("Normalize Whitespace", None)],
    },
    # ... all 16 product fields per spec
]

CUSTOMER_FIELDS = [
    {
        "name": "customer_id",
        "type": "int",
        "constraints": [],
        "validators": [],
    },
    # ... all 8 customer fields per spec
]

ALL_FIELDS = PRODUCT_FIELDS + CUSTOMER_FIELDS

PRODUCT_OPTIONAL = {
    "sale_price", "sale_end_date", "max_order_quantity",
    "discount_percent", "discount_amount",
}

CUSTOMER_OPTIONAL = {"email", "phone"}
```

- [ ] **Step 3: Add object definitions to shop_data.py**

Append object definitions. Each object has `name`, `description`, `fields` (list of dicts with `field_name`, `optional`, `is_pk`, `appears`), and `validators` (list of model validator dicts).

```python
PRODUCT_OBJECT = {
    "name": "Product",
    "description": "Shop product",
    "fields": [
        {"field_name": "name", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "sku", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "price", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "sale_price", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "sale_end_date", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "weight", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "quantity", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "min_order_quantity", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "max_order_quantity", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "discount_percent", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "discount_amount", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "in_stock", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "product_url", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "release_date", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "created_at", "optional": False, "is_pk": False, "appears": "response"},
        {"field_name": "tracking_id", "optional": False, "is_pk": True, "appears": "both"},
    ],
    "validators": [
        {
            "template": "Field Comparison",
            "parameters": {"operator": "<"},
            "field_mappings": {"field_a": "min_order_quantity", "field_b": "max_order_quantity"},
        },
        {
            "template": "Mutual Exclusivity",
            "parameters": None,
            "field_mappings": {"field_a": "discount_percent", "field_b": "discount_amount"},
        },
        {
            "template": "All Or None",
            "parameters": None,
            "field_mappings": {"field_a": "sale_price", "field_b": "sale_end_date"},
        },
        {
            "template": "Conditional Required",
            "parameters": None,
            "field_mappings": {"trigger_field": "discount_percent", "dependent_field": "sale_price"},
        },
    ],
}

CUSTOMER_OBJECT = {
    "name": "Customer",
    "description": "Shop customer",
    "fields": [
        {"field_name": "customer_id", "optional": False, "is_pk": True, "appears": "both"},
        {"field_name": "customer_name", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "email", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "phone", "optional": True, "is_pk": False, "appears": "both"},
        {"field_name": "date_of_birth", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "last_login_time", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "is_active", "optional": False, "is_pk": False, "appears": "both"},
        {"field_name": "registered_at", "optional": False, "is_pk": False, "appears": "response"},
    ],
    "validators": [
        {
            "template": "At Least One Required",
            "parameters": None,
            "field_mappings": {"field_a": "email", "field_b": "phone"},
        },
    ],
}

OBJECTS = [PRODUCT_OBJECT, CUSTOMER_OBJECT]
```

- [ ] **Step 4: Add relationship, API, and endpoint definitions**

```python
RELATIONSHIP = {
    "source_object": "Customer",
    "target_object": "Product",
    "name": "products",
    "cardinality": "has_many",
}

API = {
    "title": "ShopApi",
    "version": "1.0.0",
    "description": "Complete online shop API",
}

ENDPOINTS = [
    {"method": "GET", "path": "/products", "description": "List all products",
     "tag": "Products", "object": "Product", "path_params": [], "response_shape": "list"},
    {"method": "GET", "path": "/products/{tracking_id}", "description": "Get product by tracking ID",
     "tag": "Products", "object": "Product",
     "path_params": [{"name": "tracking_id", "field": "tracking_id"}], "response_shape": "object"},
    {"method": "POST", "path": "/products", "description": "Create a product",
     "tag": "Products", "object": "Product", "path_params": [], "response_shape": "object"},
    {"method": "PUT", "path": "/items/{tracking_id}", "description": "Update a product",
     "tag": "Products", "object": "Product",
     "path_params": [{"name": "tracking_id", "field": "tracking_id"}], "response_shape": "object"},
    {"method": "DELETE", "path": "/products/{tracking_id}", "description": "Delete a product",
     "tag": "Products", "object": None,
     "path_params": [{"name": "tracking_id", "field": "tracking_id"}], "response_shape": "object"},
    {"method": "GET", "path": "/customers", "description": "List all customers",
     "tag": "Customers", "object": "Customer", "path_params": [], "response_shape": "list"},
    {"method": "POST", "path": "/customers", "description": "Create a customer",
     "tag": "Customers", "object": "Customer", "path_params": [], "response_shape": "object"},
    {"method": "GET", "path": "/customers/{email}", "description": "Get customer by email",
     "tag": "Customers", "object": "Customer",
     "path_params": [{"name": "email", "field": "email"}], "response_shape": "object"},
    {"method": "PATCH", "path": "/customers/{email}", "description": "Update a customer by email",
     "tag": "Customers", "object": "Customer",
     "path_params": [{"name": "email", "field": "email"}], "response_shape": "object"},
]
```

- [ ] **Step 5: Verify the module imports cleanly**

Run: `cd backend && PYTHONPATH=src poetry run python -c "from api.seeding.shop_data import ALL_FIELDS, OBJECTS, ENDPOINTS, RELATIONSHIP, API; print(f'{len(ALL_FIELDS)} fields, {len(OBJECTS)} objects, {len(ENDPOINTS)} endpoints')"`

Expected: `24 fields, 2 objects, 9 endpoints`

- [ ] **Step 6: Commit**

```
feat(api): add canonical shop seed data definitions

- Define 24 fields (16 Product, 8 Customer) with constraints and validators
- Define 2 objects with model validators, appears overrides, and PK designations
- Define 1 bidirectional relationship, 1 API, and 9 endpoints
- All references use symbolic names resolved at runtime by the runner
```

---

## Task 2: Runner — `seed_shop()` and `clean_shop()`

**Files:**
- Create: `src/api/seeding/runner.py`
- Test: `tests/test_api/test_seeding.py`

**Key reference:** `tests/test_api/test_e2e_shop_full.py` — phases 1-11 show the exact API call patterns. The runner does the same thing without assertions or updates.

**Schema aliases (camelCase in JSON payloads):**
- `namespaceId`, `typeId`, `constraintId`, `templateId`, `fieldId`, `isPk`, `fieldMappings`
- `apiId`, `tagName`, `pathParams`, `objectId`, `useEnvelope`, `responseShape`
- `targetObjectId`

**Note on `fieldMappings`:** Model validator `fieldMappings` values use **field names** (strings like `"min_order_quantity"`), not field UUIDs. Verified from `test_e2e_shop_full.py:511-536` where the test passes field names directly. Constraint values are also always **strings** (e.g., `"0"`, `"1000"`) — verified from the same test (`test_e2e_shop_full.py:106`).

- [ ] **Step 1: Write the failing integration test**

Create `tests/test_api/test_seeding.py`:
```python
"""Integration test for the seed module runner."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.auth import get_current_user
from api.main import app
from api.models.database import (
    ApiModel,
    FieldModel,
    GenerationModel,
    Namespace,
    ObjectDefinition,
    UserModel,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio(loop_scope="session"),
]

TEST_CLERK_ID = "test_user_seeding"


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def client():
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
            await session.execute(delete(GenerationModel).where(GenerationModel.user_id == uid))
            await session.execute(delete(ApiModel).where(ApiModel.user_id == uid))
            await session.execute(delete(ObjectDefinition).where(ObjectDefinition.user_id == uid))
            await session.execute(delete(FieldModel).where(FieldModel.user_id == uid))
            await session.execute(delete(Namespace).where(Namespace.user_id == uid))
            await session.execute(delete(UserModel).where(UserModel.id == uid))
            await session.commit()
    await engine.dispose()


class TestSeedRunner:
    async def test_seed_creates_full_shop_structure(self, client: AsyncClient):
        from api.seeding.runner import seed_shop
        from api.seeding.shop_data import ALL_FIELDS, ENDPOINTS, OBJECTS

        result = await seed_shop(client)

        assert result.namespace_id
        assert len(result.field_ids) == len(ALL_FIELDS)
        assert len(result.object_ids) == len(OBJECTS)
        assert result.api_id
        assert len(result.endpoint_ids) == len(ENDPOINTS)
        assert len(result.relationship_ids) >= 1

        # Verify via API reads
        resp = await client.get(f"/fields?namespace_id={result.namespace_id}")
        assert resp.status_code == 200
        assert len(resp.json()) == len(ALL_FIELDS)

        resp = await client.get(f"/objects?namespace_id={result.namespace_id}")
        assert resp.status_code == 200
        objects = resp.json()
        assert len(objects) == len(OBJECTS)

        # Verify appears on Product.created_at
        resp = await client.get(f"/objects/{result.object_ids['Product']}")
        assert resp.status_code == 200
        product = resp.json()
        created_at_field = next(
            f for f in product["fields"]
            if f["fieldId"] == result.field_ids["created_at"]
        )
        assert created_at_field["appears"] == "response"

        # Verify relationship exists on Customer
        resp = await client.get(f"/objects/{result.object_ids['Customer']}")
        assert resp.status_code == 200
        customer = resp.json()
        assert len(customer.get("relationships", [])) >= 1

        resp = await client.get("/endpoints")
        assert resp.status_code == 200
        assert len(resp.json()) == len(ENDPOINTS)

    async def test_clean_removes_all_shop_data(self, client: AsyncClient):
        from api.seeding.runner import clean_shop

        await clean_shop(client)

        resp = await client.get("/namespaces")
        assert resp.status_code == 200
        names = {n["name"] for n in resp.json()}
        assert "Shop" not in names

        resp = await client.get("/endpoints")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    async def test_seed_after_clean_works(self, client: AsyncClient):
        """Verify replace mode (clean then seed) works."""
        from api.seeding.runner import clean_shop, seed_shop

        result = await seed_shop(client)
        assert result.namespace_id
        assert len(result.field_ids) == 24

        await clean_shop(client)

        resp = await client.get("/namespaces")
        names = {n["name"] for n in resp.json()}
        assert "Shop" not in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && poetry run pytest tests/test_api/test_seeding.py -v --timeout=60`

Expected: FAIL — `ModuleNotFoundError: No module named 'api.seeding.runner'`

- [ ] **Step 3: Implement runner.py — SeedError, SeedResult, catalogue resolution**

Create `src/api/seeding/runner.py`:

```python
"""Shop API seed runner — creates/deletes Shop structure via API calls."""

from __future__ import annotations

from dataclasses import dataclass, field

from httpx import AsyncClient

from api.seeding.shop_data import (
    ALL_FIELDS,
    API,
    ENDPOINTS,
    OBJECTS,
    RELATIONSHIP,
)


class SeedError(Exception):
    """Raised when a seed API call fails."""

    def __init__(self, entity_type: str, name: str, status_code: int, detail: str):
        self.entity_type = entity_type
        self.name = name
        self.status_code = status_code
        self.detail = detail
        super().__init__(
            f"Failed to create {entity_type} '{name}': "
            f"HTTP {status_code} — {detail}"
        )


@dataclass
class SeedResult:
    namespace_id: str = ""
    field_ids: dict[str, str] = field(default_factory=dict)
    object_ids: dict[str, str] = field(default_factory=dict)
    api_id: str = ""
    endpoint_ids: dict[str, str] = field(default_factory=dict)
    relationship_ids: list[str] = field(default_factory=list)


def _check(resp, entity_type: str, name: str, expected: int = 201) -> dict:
    """Check response status and return JSON, or raise SeedError."""
    if resp.status_code != expected:
        raise SeedError(entity_type, name, resp.status_code, resp.text)
    return resp.json()


async def _read_catalogues(client: AsyncClient) -> dict[str, dict[str, str]]:
    """Fetch all read-only catalogues and return name-to-ID maps."""
    catalogues = {}
    for endpoint, key in [
        ("/types", "types"),
        ("/field-constraints", "constraints"),
        ("/field-validator-templates", "fv_templates"),
        ("/model-validator-templates", "mv_templates"),
    ]:
        resp = await client.get(endpoint)
        if resp.status_code != 200:
            raise SeedError("catalogue", endpoint, resp.status_code, resp.text)
        catalogues[key] = {item["name"]: item["id"] for item in resp.json()}
    return catalogues


async def seed_shop(client: AsyncClient) -> SeedResult:
    """Create the full Shop API structure via API calls.

    The client must be pre-configured with base_url and auth headers
    (or ASGI transport with dependency overrides for tests).
    """
    result = SeedResult()
    cat = await _read_catalogues(client)

    # 1. Namespace
    resp = await client.post("/namespaces", json={"name": "Shop", "isDefault": False})
    ns = _check(resp, "namespace", "Shop")
    result.namespace_id = ns["id"]

    # 2. Fields
    for field_def in ALL_FIELDS:
        payload = {
            "namespaceId": result.namespace_id,
            "name": field_def["name"],
            "typeId": cat["types"][field_def["type"]],
            "constraints": [
                {"constraintId": cat["constraints"][cname], "value": cval}
                for cname, cval in field_def["constraints"]
            ],
            "validators": [
                {"templateId": cat["fv_templates"][tname], "parameters": params}
                for tname, params in field_def["validators"]
            ],
        }
        resp = await client.post("/fields", json=payload)
        f = _check(resp, "field", field_def["name"])
        result.field_ids[field_def["name"]] = f["id"]

    # 3. Objects
    for obj_def in OBJECTS:
        obj_fields = []
        for fref in obj_def["fields"]:
            obj_fields.append({
                "fieldId": result.field_ids[fref["field_name"]],
                "optional": fref["optional"],
                "isPk": fref["is_pk"],
                "appears": fref["appears"],
            })
        obj_validators = []
        for vdef in obj_def["validators"]:
            obj_validators.append({
                "templateId": cat["mv_templates"][vdef["template"]],
                "parameters": vdef["parameters"],
                "fieldMappings": vdef["field_mappings"],
            })
        payload = {
            "namespaceId": result.namespace_id,
            "name": obj_def["name"],
            "description": obj_def["description"],
            "fields": obj_fields,
            "validators": obj_validators,
        }
        resp = await client.post("/objects", json=payload)
        obj = _check(resp, "object", obj_def["name"])
        result.object_ids[obj_def["name"]] = obj["id"]

    # 4. Relationship (auto-creates bidirectional inverse)
    source_id = result.object_ids[RELATIONSHIP["source_object"]]
    resp = await client.post(
        f"/objects/{source_id}/relationships",
        json={
            "targetObjectId": result.object_ids[RELATIONSHIP["target_object"]],
            "name": RELATIONSHIP["name"],
            "cardinality": RELATIONSHIP["cardinality"],
        },
    )
    rel = _check(resp, "relationship", RELATIONSHIP["name"])
    result.relationship_ids.append(rel["id"])
    if rel.get("inverseId"):
        result.relationship_ids.append(rel["inverseId"])

    # 5. API
    resp = await client.post(
        "/apis",
        json={
            "namespaceId": result.namespace_id,
            "title": API["title"],
            "version": API["version"],
            "description": API["description"],
        },
    )
    api = _check(resp, "api", API["title"])
    result.api_id = api["id"]

    # 6. Endpoints
    for ep_def in ENDPOINTS:
        path_params = [
            {"name": pp["name"], "fieldId": result.field_ids[pp["field"]]}
            for pp in ep_def["path_params"]
        ]
        payload = {
            "apiId": result.api_id,
            "method": ep_def["method"],
            "path": ep_def["path"],
            "description": ep_def["description"],
            "tagName": ep_def["tag"],
            "pathParams": path_params,
            "useEnvelope": False,
            "responseShape": ep_def["response_shape"],
        }
        if ep_def["object"] is not None:
            payload["objectId"] = result.object_ids[ep_def["object"]]
        resp = await client.post("/endpoints", json=payload)
        ep = _check(resp, "endpoint", f"{ep_def['method']} {ep_def['path']}")
        result.endpoint_ids[f"{ep_def['method']} {ep_def['path']}"] = ep["id"]

    return result


async def clean_shop(client: AsyncClient) -> None:
    """Delete the Shop namespace and all its contents.

    Deletes in reverse dependency order:
    endpoints -> APIs -> objects (cascade deletes relationships) -> fields -> namespace.
    """
    # Find Shop namespace
    resp = await client.get("/namespaces")
    if resp.status_code != 200:
        raise SeedError("catalogue", "namespaces", resp.status_code, resp.text)
    shop_ns = None
    for ns in resp.json():
        if ns["name"] == "Shop":
            shop_ns = ns
            break
    if shop_ns is None:
        return  # Nothing to clean

    ns_id = shop_ns["id"]

    # Delete endpoints (only those belonging to Shop APIs)
    resp = await client.get(f"/apis?namespace_id={ns_id}")
    api_ids = set()
    if resp.status_code == 200:
        api_ids = {api["id"] for api in resp.json()}

    resp = await client.get("/endpoints")
    if resp.status_code == 200:
        for ep in resp.json():
            if ep.get("apiId") in api_ids:
                await client.delete(f"/endpoints/{ep['id']}")

    # Delete APIs
    resp = await client.get(f"/apis?namespace_id={ns_id}")
    if resp.status_code == 200:
        for api in resp.json():
            await client.delete(f"/apis/{api['id']}")

    # Delete objects (cascade deletes relationships)
    resp = await client.get(f"/objects?namespace_id={ns_id}")
    if resp.status_code == 200:
        for obj in resp.json():
            await client.delete(f"/objects/{obj['id']}")

    # Delete fields
    resp = await client.get(f"/fields?namespace_id={ns_id}")
    if resp.status_code == 200:
        for f in resp.json():
            await client.delete(f"/fields/{f['id']}")

    # Delete namespace
    await client.delete(f"/namespaces/{ns_id}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_api/test_seeding.py -v --timeout=60`

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```
feat(api): add seed runner with seed_shop and clean_shop

- Implement catalogue resolution, field/object/relationship/API/endpoint creation
- Add SeedError with entity context and SeedResult dataclass
- Add clean_shop with reverse-dependency-order deletion
- Add integration tests verifying full seed→verify→clean cycle
```

---

## Task 3: Public API (`__init__.py`)

**Files:**
- Modify: `src/api/seeding/__init__.py`

- [ ] **Step 1: Update __init__.py with re-exports**

```python
"""Shop API seeding module.

Public API:
    seed_shop(client) -> SeedResult   — Create Shop API structure
    clean_shop(client) -> None        — Delete Shop namespace subtree
    SeedResult                        — Dataclass with created entity IDs
    SeedError                         — Raised on API call failure
"""

from api.seeding.runner import SeedError, SeedResult, clean_shop, seed_shop

__all__ = ["seed_shop", "clean_shop", "SeedResult", "SeedError"]
```

- [ ] **Step 2: Verify import works**

Run: `cd backend && PYTHONPATH=src poetry run python -c "from api.seeding import seed_shop, clean_shop, SeedResult, SeedError; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```
feat(api): add seeding package public API

- Re-export seed_shop, clean_shop, SeedResult, SeedError from __init__
```

---

## Task 4: Clerk Auth Helper (`clerk_auth.py`)

**Files:**
- Create: `src/api/seeding/clerk_auth.py`

- [ ] **Step 1: Implement mint_clerk_jwt**

Create `src/api/seeding/clerk_auth.py`. Uses raw httpx calls to Clerk Backend API (no Clerk SDK dependency).

```python
"""Clerk JWT minting for live API seeding.

Uses CLERK_SECRET_KEY to:
1. Find user by email
2. Get their active session
3. Mint a JWT from that session
"""

from __future__ import annotations

import httpx

CLERK_API_BASE = "https://api.clerk.com/v1"


class ClerkAuthError(Exception):
    """Raised when Clerk JWT minting fails."""


async def mint_clerk_jwt(email: str, clerk_secret_key: str) -> str:
    """Mint a Clerk session JWT for the given user email.

    Args:
        email: The user's email address (must exist in Clerk).
        clerk_secret_key: The CLERK_SECRET_KEY (sk_live_... or sk_test_...).

    Returns:
        A JWT string suitable for Authorization: Bearer headers.

    Raises:
        ClerkAuthError: If the user is not found, has no active sessions, or token minting fails.
    """
    headers = {"Authorization": f"Bearer {clerk_secret_key}"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Find user by email
        resp = await client.get(
            f"{CLERK_API_BASE}/users",
            params={"email_address": [email]},
            headers=headers,
        )
        if resp.status_code != 200:
            raise ClerkAuthError(f"Failed to search users: HTTP {resp.status_code} — {resp.text}")
        users = resp.json()
        if not users:
            raise ClerkAuthError(f"No Clerk user found with email: {email}")
        user_id = users[0]["id"]

        # 2. Get active sessions
        resp = await client.get(
            f"{CLERK_API_BASE}/sessions",
            params={"user_id": user_id, "status": "active"},
            headers=headers,
        )
        if resp.status_code != 200:
            raise ClerkAuthError(f"Failed to list sessions: HTTP {resp.status_code} — {resp.text}")
        sessions = resp.json()
        if not sessions:
            raise ClerkAuthError(
                f"No active Clerk session for user {email}. "
                "The user must be logged in via the frontend."
            )
        session_id = sessions[0]["id"]

        # 3. Mint JWT
        resp = await client.post(
            f"{CLERK_API_BASE}/sessions/{session_id}/tokens",
            headers=headers,
        )
        if resp.status_code != 200:
            raise ClerkAuthError(f"Failed to mint JWT: HTTP {resp.status_code} — {resp.text}")
        token_data = resp.json()
        jwt = token_data.get("jwt") or token_data.get("token")
        if not jwt:
            raise ClerkAuthError(f"No JWT in Clerk response: {token_data}")
        return jwt
```

- [ ] **Step 2: Verify import works**

Run: `cd backend && PYTHONPATH=src poetry run python -c "from api.seeding.clerk_auth import mint_clerk_jwt, ClerkAuthError; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```
feat(api): add Clerk JWT minting for live API seeding

- Implement mint_clerk_jwt using raw httpx calls to Clerk Backend API
- Find user by email, get active session, mint session token
- Add ClerkAuthError for clear failure messages
```

---

## Task 5: CLI Entrypoint (`__main__.py`)

**Files:**
- Create: `src/api/seeding/__main__.py`

- [ ] **Step 1: Implement the CLI**

Create `src/api/seeding/__main__.py`:

```python
"""CLI entrypoint for Shop API seeding.

Usage:
    poetry run python -m api.seeding --target local --user-email user@example.com
    poetry run python -m api.seeding --base-url https://api.dev.mediancode.com/v1 --user-email user@example.com --mode apply
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import httpx

TARGET_URLS = {
    "local": "http://localhost:8001/v1",
    "dev": "https://api.dev.mediancode.com/v1",
    "prod": "https://api.mediancode.com/v1",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m api.seeding",
        description="Seed the Shop API structure via REST API calls.",
    )
    url_group = parser.add_mutually_exclusive_group(required=True)
    url_group.add_argument(
        "--base-url", help="Target API base URL (e.g., http://localhost:8001/v1)"
    )
    url_group.add_argument(
        "--target",
        choices=["local", "dev", "prod"],
        help="Target environment alias",
    )
    parser.add_argument("--user-email", required=True, help="Clerk user email")
    parser.add_argument(
        "--bearer-token", help="Skip Clerk JWT flow, use this token directly"
    )
    parser.add_argument(
        "--mode",
        choices=["replace", "apply", "delete"],
        default="replace",
        help="Seeding mode (default: replace)",
    )
    parser.add_argument("--verbose", action="store_true", help="Print detailed progress")
    return parser.parse_args(argv)


async def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    base_url = args.base_url or TARGET_URLS[args.target]

    # Resolve auth
    if args.bearer_token:
        token = args.bearer_token
    else:
        from api.seeding.clerk_auth import ClerkAuthError, mint_clerk_jwt

        # Load CLERK_SECRET_KEY from environment
        import os

        clerk_key = os.environ.get("CLERK_SECRET_KEY")
        if not clerk_key:
            # Try loading from .env.local
            env_file = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env.local")
            if os.path.exists(env_file):
                with open(env_file) as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("CLERK_SECRET_KEY="):
                            clerk_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                            break
        if not clerk_key:
            print("Error: CLERK_SECRET_KEY not found in environment or .env.local", file=sys.stderr)
            sys.exit(1)

        if args.verbose:
            print(f"Minting Clerk JWT for {args.user_email}...")
        try:
            token = await mint_clerk_jwt(args.user_email, clerk_key)
        except ClerkAuthError as e:
            print(f"Auth error: {e}", file=sys.stderr)
            sys.exit(1)
        if args.verbose:
            print("JWT acquired.")

    from api.seeding.runner import SeedError, clean_shop, seed_shop

    async with httpx.AsyncClient(
        base_url=base_url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    ) as client:
        try:
            if args.mode == "delete":
                if args.verbose:
                    print("Deleting Shop data...")
                await clean_shop(client)
                print("Shop data deleted.")

            elif args.mode == "replace":
                if args.verbose:
                    print("Cleaning existing Shop data...")
                await clean_shop(client)
                if args.verbose:
                    print("Seeding Shop API...")
                result = await seed_shop(client)
                print(f"Shop API seeded. Namespace: {result.namespace_id}, "
                      f"API: {result.api_id}, "
                      f"{len(result.field_ids)} fields, "
                      f"{len(result.object_ids)} objects, "
                      f"{len(result.endpoint_ids)} endpoints.")

            elif args.mode == "apply":
                print(
                    "Error: --mode apply is not yet implemented. "
                    "Use --mode replace (delete + recreate) or --mode delete.",
                    file=sys.stderr,
                )
                sys.exit(1)

        except SeedError as e:
            print(f"Seed error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
```

Note: `apply` mode (reconcile: GET-then-POST-or-PUT) is deferred — the CLI rejects `--mode apply` with a clear "not yet implemented" message. Only `replace` and `delete` modes are implemented in v1. The spec defines `apply` mode semantics for when it is needed in the future.

- [ ] **Step 2: Verify CLI help works**

Run: `cd backend && PYTHONPATH=src poetry run python -m api.seeding --help`

Expected: Shows usage with `--base-url`, `--target`, `--user-email`, `--mode`, etc.

- [ ] **Step 3: Verify CLI arg validation**

Run: `cd backend && PYTHONPATH=src poetry run python -m api.seeding --target local --base-url http://x --user-email test@test.com 2>&1 || true`

Expected: Error about mutually exclusive args.

- [ ] **Step 4: Commit**

```
feat(api): add CLI entrypoint for shop API seeding

- Add argparse CLI with --target/--base-url, --user-email, --mode, --bearer-token
- Wire Clerk JWT minting with .env.local fallback for CLERK_SECRET_KEY
- Support replace (default), apply, and delete modes
```

---

## Task 6: Refactor E2E Test to Use Shared Data

**Files:**
- Modify: `tests/test_api/test_e2e_shop_full.py`

**Important:** This is a careful refactoring. The test must continue to pass exactly as before, but with data imported from `shop_data.py` instead of defined inline. The update phases must override specific values at creation time.

- [ ] **Step 1: Run the existing E2E test to establish a baseline**

Run: `cd backend && poetry run pytest tests/test_api/test_e2e_shop_full.py -v --timeout=120`

Expected: All phases PASS. Record the number of passing tests.

- [ ] **Step 2: Replace inline field definitions with imports**

In `tests/test_api/test_e2e_shop_full.py`, replace the inline `PRODUCT_FIELDS`, `CUSTOMER_FIELDS`, `ALL_FIELDS`, `PRODUCT_OPTIONAL`, `CUSTOMER_OPTIONAL` definitions (lines ~102-264) with imports from the shared module:

```python
from api.seeding.shop_data import (
    ALL_FIELDS,
    CUSTOMER_FIELDS,
    CUSTOMER_OPTIONAL,
    PRODUCT_FIELDS,
    PRODUCT_OPTIONAL,
)
```

The test's existing field definitions should be deleted and replaced with these imports. The shared data already has the final-state values.

For the **update test phases** that need initial (non-final) values, add test-local overrides:

```python
# Test-local overrides for update phases.
# Phase 3 creates with these values; Phase 5 updates to the final values from shop_data.
FIELD_CREATION_OVERRIDES = {
    "name": {
        "constraints": [("min_length", "1"), ("max_length", "200")],  # final: 150
    },
    "customer_name": {
        "validators": [("Trim", None), ("Normalize Case", {"case": "title"})],  # final: +Trim To Length
    },
}
```

In Phase 3 (create fields), apply overrides:
```python
for field_def in ALL_FIELDS:
    overrides = FIELD_CREATION_OVERRIDES.get(field_def["name"], {})
    constraints = overrides.get("constraints", field_def["constraints"])
    validators = overrides.get("validators", field_def["validators"])
    # ... use constraints/validators in the payload instead of field_def's
```

- [ ] **Step 3: Add missing endpoints (POST /customers, GET /customers/{email})**

In Phase 11 (create endpoints), add the 2 missing endpoints. Import `ENDPOINTS` from `shop_data.py` to get the canonical list, or add them inline matching the spec:

```python
# Add to the endpoints list in Phase 11:
{
    "apiId": cls.api_id,
    "method": "POST",
    "path": "/customers",
    "description": "Create a customer",
    "tagName": "Customers",
    "pathParams": [],
    "objectId": cls.customer_id,
    "useEnvelope": False,
    "responseShape": "object",
},
{
    "apiId": cls.api_id,
    "method": "GET",
    "path": "/customers/{email}",
    "description": "Get customer by email",
    "tagName": "Customers",
    "pathParams": [{"name": "email", "fieldId": cls.field_ids["email"]}],
    "objectId": cls.customer_id,
    "useEnvelope": False,
    "responseShape": "object",
},
```

Update the endpoint count assertion from `7` to `9`.

- [ ] **Step 4: Add `appears` to object field associations**

In Phase 6 (create objects), add `"appears"` to the field association dicts. For most fields use `"both"` (default). Override:
- Product `created_at`: `"appears": "response"`
- Customer `registered_at`: `"appears": "response"`

- [ ] **Step 5: Add relationship creation**

Add a new phase between current Phase 8 (update object) and Phase 9 (create API). Create the Customer→Product relationship:

```python
async def test_phase_08b_create_relationship(self, client: AsyncClient):
    """Create Customer has_many Products relationship."""
    cls = TestShopApiFullE2E
    resp = await client.post(
        f"/objects/{cls.customer_id}/relationships",
        json={
            "targetObjectId": cls.product_id,
            "name": "products",
            "cardinality": "has_many",
        },
    )
    assert resp.status_code == 201
    rel = resp.json()
    assert rel["name"] == "products"
    assert rel["cardinality"] == "has_many"
    assert rel["isInferred"] is False
    assert rel["inverseId"] is not None
    cls.relationship_id = rel["id"]
    cls.inverse_relationship_id = rel["inverseId"]
```

- [ ] **Step 6: Update cleanup phases for new entities**

Update cleanup phases to delete the 2 extra endpoints and the relationship. The endpoint cleanup already iterates `cls.endpoint_ids`, so just ensure the new endpoints are tracked. For relationships, object deletion cascades them — no explicit cleanup needed.

Update the endpoint count assertions:
- Phase 12 (read endpoints): assert `len(endpoints) == 9`
- Phase 22 (delete endpoints): the existing loop handles any count

- [ ] **Step 7: Run the E2E test to verify all phases pass**

Run: `cd backend && poetry run pytest tests/test_api/test_e2e_shop_full.py -v --timeout=120`

Expected: All phases PASS (same count as baseline plus the new relationship phase).

- [ ] **Step 8: Run the seeding integration test too**

Run: `cd backend && poetry run pytest tests/test_api/test_seeding.py -v --timeout=60`

Expected: All 3 tests PASS.

- [ ] **Step 9: Commit**

```
refactor(api): use shared seed data in E2E shop test

- Import field definitions from api.seeding.shop_data instead of inline dicts
- Add test-local overrides for update-phase initial values
- Add 2 missing endpoints (POST /customers, GET /customers/{email})
- Add appears field on object-field associations (created_at, registered_at)
- Add Customer has_many Products relationship creation and assertions
```

---

## Task 7: Delete Superseded Files

**Files:**
- Delete: `scripts/test_generation.py`
- Delete: `docs/seed-shop-api.sql`

- [ ] **Step 1: Run full test suite to ensure nothing depends on these files**

Run: `cd backend && make test`

Expected: All tests pass.

- [ ] **Step 2: Delete the files**

```bash
cd backend && git rm scripts/test_generation.py docs/seed-shop-api.sql
```

- [ ] **Step 3: Run tests again to verify nothing broke**

Run: `cd backend && make test`

Expected: All tests pass (no test imports these files).

- [ ] **Step 4: Commit**

```
chore(api): remove superseded shop seed files

- Delete docs/seed-shop-api.sql (replaced by api.seeding.shop_data)
- Delete scripts/test_generation.py (replaced by python -m api.seeding)
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full test suite including E2E**

Run: `cd backend && make test && make test-e2e`

Expected: All tests pass.

- [ ] **Step 2: Run the seed module's own test**

Run: `cd backend && poetry run pytest tests/test_api/test_seeding.py -v --timeout=60`

Expected: 3/3 pass.

- [ ] **Step 3: Verify CLI smoke test**

Run: `cd backend && PYTHONPATH=src poetry run python -m api.seeding --help`

Expected: Shows help text.

- [ ] **Step 4: Format code**

Run: `cd backend && poetry run black src/api/seeding/ tests/test_api/test_seeding.py`

Expected: Files formatted (or already clean).

- [ ] **Step 5: Verify imports from the public API**

Run: `cd backend && PYTHONPATH=src poetry run python -c "from api.seeding import seed_shop, clean_shop, SeedResult, SeedError; from api.seeding.shop_data import ALL_FIELDS, OBJECTS, ENDPOINTS; from api.seeding.clerk_auth import mint_clerk_jwt; print('All imports OK')"`

Expected: `All imports OK`
