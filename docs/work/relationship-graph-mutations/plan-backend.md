# Backend Plan: Relationship Graph Mutations

> **For Claude:** REQUIRED SUB-SKILL: Use autonomous-executing-plans

## Goal

Change relationship create/delete endpoints to return a composite `RelationshipMutationResponse` containing all updated objects and created/deleted fields, so the frontend can reconcile all stores atomically.

## Architecture

The relationship endpoints currently return either `ObjectRelationshipResponse` (create) or `204 No Content` (delete). Both need to return a new `RelationshipMutationResponse` that includes:
- All updated `ObjectResponse` entities (source + target, with fresh field and relationship lists)
- All newly created `FieldResponse` entities (FK fields)
- IDs of deleted fields (for deletion reconciliation)

The `RelationshipService` already creates/deletes FK fields. The change is in the **router layer** — after the service does its work, we load the affected objects and fields and return them all.

## Tech Stack

Python 3.13+, FastAPI, SQLAlchemy 2.x (async), Pydantic v2, pytest.

## Prerequisite

FK field auto-creation must be implemented (plan at `docs/work/fk-field-auto-creation/plan-backend.md`).

---

## Part 1: New Response Schema

### Task 1.1: Create RelationshipMutationResponse schema

**Files:** `src/api/schemas/relationship.py`

**Steps:**

1. Import `FieldResponse` and `ObjectResponse` at the top:

```python
from api.schemas.field import FieldResponse
from api.schemas.object import ObjectResponse
```

2. Add the new response schema after `ObjectRelationshipResponse`:

```python
class RelationshipMutationResponse(BaseModel):
    """Response for relationship create/delete — includes all side effects.

    :ivar updated_objects: All objects whose fields or relationships changed.
    :ivar created_fields: Newly auto-created FK field entities.
    :ivar deleted_field_ids: IDs of FK fields that were deleted.
    """

    updated_objects: list[ObjectResponse] = Field(
        default_factory=list, alias="updatedObjects"
    )
    created_fields: list[FieldResponse] = Field(
        default_factory=list, alias="createdFields"
    )
    deleted_field_ids: list[UUID] = Field(
        default_factory=list, alias="deletedFieldIds"
    )

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
```

**Test:** `cd backend && make test`

**Commit:** `feat(schemas): add RelationshipMutationResponse for graph mutations`

---

## Part 2: Update Router Endpoints

### Task 2.1: Update create_relationship endpoint

**Files:** `src/api/routers/objects.py`

**Steps:**

1. Import the new schema:

```python
from api.schemas.relationship import (
    ObjectRelationshipCreate,
    ObjectRelationshipResponse,
    RelationshipMutationResponse,
)
```

2. Change the `create_relationship` endpoint's `response_model` from `ObjectRelationshipResponse` to `RelationshipMutationResponse`.

3. After calling `rel_service.create_relationship()`, load both source and target objects with their full field/relationship data, and load any created FK fields. Build and return the composite response.

The key logic: after `create_relationship` returns, we need to re-fetch both the source and target objects (since both may have new relationships and FK fields). We also need to fetch the FK field entities themselves.

```python
    rel = await rel_service.create_relationship(obj.id, data)
    await db.commit()

    # Re-fetch both objects with fresh data
    source_obj = await obj_service.get_by_id_for_user(str(obj.id), user.id)
    target_obj = await obj_service.get_by_id_for_user(str(data.target_object_id), user.id)

    updated_objects = []
    if source_obj:
        updated_objects.append(obj_service.to_response(source_obj))
    if target_obj:
        updated_objects.append(obj_service.to_response(target_obj))

    # Collect created FK fields
    created_fields = []
    if rel.fk_field_id:
        fk_field = await db.get(FieldModel, rel.fk_field_id)
        if fk_field:
            created_fields.append(field_service.to_response(fk_field))
    # Check inverse for FK field too
    if rel.inverse_id:
        inverse = await db.get(ObjectRelationship, rel.inverse_id)
        if inverse and inverse.fk_field_id:
            fk_field = await db.get(FieldModel, inverse.fk_field_id)
            if fk_field:
                created_fields.append(field_service.to_response(fk_field))

    return RelationshipMutationResponse(
        updated_objects=updated_objects,
        created_fields=created_fields,
        deleted_field_ids=[],
    )
```

Note: You'll need to add a `to_response` method to the object and field services (or use the existing response construction pattern). Check how `ObjectResponse` is currently built in the list/get endpoints and replicate that pattern.

**Test:** `cd backend && make test`

**Commit:** `feat(api): return graph mutation response from create_relationship`

### Task 2.2: Update delete_relationship endpoint

**Files:** `src/api/routers/objects.py`

**Steps:**

1. Change the `delete_relationship` endpoint's `status_code` from `204` to `200`, and set `response_model=RelationshipMutationResponse`.

2. Before deleting, capture the FK field IDs and the target object ID:

```python
    rel_service = get_relationship_service(db)
    rel = await rel_service.get_by_id(relationship_id)
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")

    # Capture side effect data before deletion
    deleted_field_ids = []
    target_object_id = rel.target_object_id
    if rel.fk_field_id:
        deleted_field_ids.append(rel.fk_field_id)
    if rel.inverse_id:
        inverse = await rel_service.get_by_id(rel.inverse_id)
        if inverse and inverse.fk_field_id:
            deleted_field_ids.append(inverse.fk_field_id)

    await rel_service.delete_relationship(relationship_id)
    await db.commit()

    # Re-fetch both objects with fresh data
    source_obj = await obj_service.get_by_id_for_user(object_id, user.id)
    target_obj = await obj_service.get_by_id_for_user(str(target_object_id), user.id)

    updated_objects = []
    if source_obj:
        updated_objects.append(obj_service.to_response(source_obj))
    if target_obj:
        updated_objects.append(obj_service.to_response(target_obj))

    return RelationshipMutationResponse(
        updated_objects=updated_objects,
        created_fields=[],
        deleted_field_ids=deleted_field_ids,
    )
```

**Test:** `cd backend && make test`

**Commit:** `feat(api): return graph mutation response from delete_relationship`

---

## Part 3: Service Layer — Response Building

### Task 3.1: Add response building helpers

**Files:** `src/api/services/object.py` (or wherever `ObjectResponse` is currently constructed)

**Steps:**

1. Check how the existing list/get endpoints build `ObjectResponse`. If there's already a `to_response` method or helper function, reuse it. If the response is built inline in the router, extract it into a reusable helper.

2. The helper needs to load the object with all its associations (fields, relationships, validators) and build an `ObjectResponse`. This is the same logic used by `GET /objects/{id}`.

3. Similarly for `FieldResponse` — check how `GET /fields/{id}` builds it and ensure we can reuse that pattern.

**Test:** `cd backend && make test`

**Commit:** `refactor(api): extract reusable response builders for object and field`

---

## Part 4: Tests

### Task 4.1: Update relationship endpoint tests

**Files:** Tests for relationship create/delete endpoints.

**Steps:**

1. Update existing tests that assert `ObjectRelationshipResponse` to expect `RelationshipMutationResponse` instead.

2. Add tests verifying:
   - `create_relationship` returns both source and target in `updatedObjects`
   - `create_relationship` returns FK field in `createdFields` for `references` cardinality
   - `create_relationship` returns FK field for inferred `references` inverse
   - `delete_relationship` returns both objects in `updatedObjects`
   - `delete_relationship` returns FK field IDs in `deletedFieldIds`
   - `many_to_many` create returns no `createdFields`

**Test:** `cd backend && make test`

**Commit:** `test(api): add graph mutation response tests for relationship endpoints`

---

## Part 5: Final Verification

### Task 5.1: Run full test suite

**Steps:**

1. Format: `cd backend && poetry run black src/ tests/`
2. Run unit tests: `cd backend && make test`
3. Run E2E tests: `cd backend && make test-e2e`
4. Fix any failures.

**Commit:** (only if needed) `style(api): format with black`

---

## Expected API Contract

### POST /objects/{id}/relationships

**Request:**
```json
{
  "targetObjectId": "customer-uuid",
  "name": "customer",
  "cardinality": "references"
}
```

**Response (200):**
```json
{
  "updatedObjects": [
    {
      "id": "product-uuid",
      "name": "Product",
      "fields": [
        {"fieldId": "name-field", "role": "writable", "optional": false},
        {"fieldId": "fk-field-uuid", "role": "fk", "optional": false}
      ],
      "relationships": [
        {"id": "rel-uuid", "name": "customer", "cardinality": "references", "fkFieldId": "fk-field-uuid"}
      ]
    },
    {
      "id": "customer-uuid",
      "name": "Customer",
      "fields": [...],
      "relationships": [
        {"id": "inverse-uuid", "name": "products", "cardinality": "has_many", "isInferred": true}
      ]
    }
  ],
  "createdFields": [
    {
      "id": "fk-field-uuid",
      "name": "customer_id",
      "typeId": "uuid-type-id",
      "namespaceId": "ns-uuid"
    }
  ],
  "deletedFieldIds": []
}
```

### DELETE /objects/{id}/relationships/{rel_id}

**Response (200):**
```json
{
  "updatedObjects": [
    {"id": "product-uuid", "name": "Product", "fields": [...], "relationships": [...]},
    {"id": "customer-uuid", "name": "Customer", "fields": [...], "relationships": [...]}
  ],
  "createdFields": [],
  "deletedFieldIds": ["fk-field-uuid"]
}
```
