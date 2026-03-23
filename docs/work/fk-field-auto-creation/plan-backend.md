# Backend Plan: FK Field Auto-Creation

> **For Claude:** REQUIRED SUB-SKILL: Use autonomous-executing-plans

## Goal

Make FK fields real persisted entities that are automatically created, renamed, and deleted by the `RelationshipService` when `references` relationships are managed.

## Architecture

The FK auto-creation lives entirely in `RelationshipService`. When `create_relationship()` creates a `references` relationship (or its inferred inverse is `references`), the service:

1. Looks up the target object's PK field via its `ObjectFieldAssociation` with `role='pk'`
2. Creates a `FieldModel` with name `{rel.name}_id` and the same `type_id` as the target PK
3. Creates an `ObjectFieldAssociation` linking the field to the source object with `role='fk'`
4. Stores the association's field ID on the `ObjectRelationship` as `fk_field_id`

The `fk` role flows through the existing generation pipeline: `generation.py` maps it to `read_write` exposure, `schema_splitter.py` already has dedup guards, and `orm_builder.py` finds the existing field instead of synthesizing a new one.

## Tech Stack

Python 3.13+, FastAPI, SQLAlchemy 2.x (async), PostgreSQL, Alembic, pytest.

## Prerequisite

Design spec at: `docs/work/fk-field-auto-creation/spec.md`

---

## Part 1: Add `fk` Role to the System

### Task 1.1: Add `fk` to FieldRole enum and CHECK constraints

**Files:** `src/api/models/database.py`, `src/api_craft/models/enums.py`

**Steps:**

1. In `src/api_craft/models/enums.py` (~line 25), add `"fk"` to the `FieldRole` Literal:

**Before:**
```python
FieldRole = Literal[
    "pk",
    "writable",
    "write_only",
    "read_only",
    "created_timestamp",
    "updated_timestamp",
    "generated_uuid",
]
```

**After:**
```python
FieldRole = Literal[
    "pk",
    "fk",
    "writable",
    "write_only",
    "read_only",
    "created_timestamp",
    "updated_timestamp",
    "generated_uuid",
]
```

2. In `src/api/models/database.py` (~line 472), add `'fk'` to the CHECK constraint on `fields_on_objects.role`:

**Before:**
```python
        CheckConstraint(
            "role IN ('pk', 'writable', 'write_only', 'read_only', "
            "'created_timestamp', 'updated_timestamp', 'generated_uuid')",
            name="ck_fields_on_objects_role",
        ),
```

**After:**
```python
        CheckConstraint(
            "role IN ('pk', 'fk', 'writable', 'write_only', 'read_only', "
            "'created_timestamp', 'updated_timestamp', 'generated_uuid')",
            name="ck_fields_on_objects_role",
        ),
```

**Test:** `cd backend && make test`

**Commit:** `feat(models): add fk to FieldRole enum and CHECK constraint`

### Task 1.2: Map `fk` role to `read_write` exposure in generation.py

**Files:** `src/api/services/generation.py`

**Steps:**

1. In `_ROLE_TO_EXPOSURE` (~line 188), add the `fk` mapping:

**Before:**
```python
_ROLE_TO_EXPOSURE: dict[str, str] = {
    "pk": "read_only",
    "writable": "read_write",
```

**After:**
```python
_ROLE_TO_EXPOSURE: dict[str, str] = {
    "pk": "read_only",
    "fk": "read_write",
    "writable": "read_write",
```

2. No changes needed to `_ROLE_GENERATED_STRATEGY` or `_ROLE_IS_PK` — `fk` has no generated strategy and is not a PK.

**Test:** `cd backend && make test`

**Commit:** `feat(generation): map fk role to read_write exposure`

### Task 1.3: Add `fk` to Pydantic schema literals

**Files:** `src/api/schemas/literals.py`

**Steps:**

1. Find the `FieldRole` Literal in `literals.py` and add `"fk"`:

```python
FieldRole = Literal["pk", "fk", "writable", "write_only", "read_only",
                    "created_timestamp", "updated_timestamp", "generated_uuid"]
```

**Test:** `cd backend && make test`

**Commit:** `feat(schemas): add fk to FieldRole literal`

---

## Part 2: Add `fk_field_id` to ObjectRelationship

### Task 2.1: Add `fk_field_id` column to ObjectRelationship model

**Files:** `src/api/models/database.py`

**Steps:**

1. In `ObjectRelationship` (~line 540, after `position`), add:

```python
    fk_field_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fields.id", ondelete="SET NULL"),
        nullable=True,
    )
```

2. Update the initial migration in-place (per project rules — no new migrations during development).

**Test:** `cd backend && make test`

**Commit:** `feat(models): add fk_field_id to ObjectRelationship`

### Task 2.2: Add `fk_field_id` to response schema

**Files:** `src/api/schemas/relationship.py`

**Steps:**

1. In `ObjectRelationshipResponse` (~line 44, after `inverse_id`), add:

```python
    fk_field_id: UUID | None = Field(default=None, alias="fkFieldId")
```

**Test:** `cd backend && make test`

**Commit:** `feat(schemas): add fkFieldId to relationship response`

---

## Part 3: Implement FK Auto-Creation in RelationshipService

### Task 3.1: Add FK field creation helper

**Files:** `src/api/services/relationship.py`

**Steps:**

1. Add imports at the top:

```python
from api.models.database import (
    ObjectDefinition,
    ObjectRelationship,
    ObjectFieldAssociation,
    FieldModel,
)
from sqlalchemy import select
from sqlalchemy.orm import selectinload
```

2. Add a private helper method to `RelationshipService`:

```python
    async def _create_fk_field(
        self,
        source_object: ObjectDefinition,
        target_object: ObjectDefinition,
        relationship_name: str,
    ) -> UUID:
        """Create a FK field and association for a references relationship.

        :param source_object: The object that owns the FK column.
        :param target_object: The referenced object (FK points to its PK).
        :param relationship_name: Used to derive FK field name ({name}_id).
        :returns: The created field's ID.
        """
        # Find target PK field
        pk_assoc = next(
            (a for a in target_object.field_associations if a.role == "pk"),
            None,
        )
        if not pk_assoc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Target object '{target_object.name}' has no PK field",
            )
        pk_field = pk_assoc.field

        # Create FK field with same type as target PK
        fk_field = FieldModel(
            namespace_id=source_object.namespace_id,
            user_id=source_object.user_id,
            name=f"{relationship_name}_id",
            type_id=pk_field.type_id,
            description=f"FK reference to {target_object.name}",
        )
        self.db.add(fk_field)
        await self.db.flush()

        # Create association linking FK field to source object
        max_pos = max(
            (a.position for a in source_object.field_associations), default=-1
        )
        assoc = ObjectFieldAssociation(
            object_id=source_object.id,
            field_id=fk_field.id,
            role="fk",
            nullable=False,
            position=max_pos + 1,
        )
        self.db.add(assoc)
        await self.db.flush()

        return fk_field.id
```

**Test:** `cd backend && make test`

**Commit:** `feat(relationships): add FK field creation helper`

### Task 3.2: Wire FK creation into create_relationship

**Files:** `src/api/services/relationship.py`

**Steps:**

1. Update `create_relationship` to eager-load field associations on both source and target objects. Change the object lookups (~lines 50, 57) to use queries with `selectinload`:

**Before:**
```python
        source = await self.db.get(ObjectDefinition, source_object_id)
        ...
        target = await self.db.get(ObjectDefinition, data.target_object_id)
```

**After:**
```python
        result = await self.db.execute(
            select(ObjectDefinition)
            .where(ObjectDefinition.id == source_object_id)
            .options(
                selectinload(ObjectDefinition.field_associations).selectinload(
                    ObjectFieldAssociation.field
                )
            )
        )
        source = result.scalars().first()
        if not source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Source object '{source_object_id}' not found",
            )

        result = await self.db.execute(
            select(ObjectDefinition)
            .where(ObjectDefinition.id == data.target_object_id)
            .options(
                selectinload(ObjectDefinition.field_associations).selectinload(
                    ObjectFieldAssociation.field
                )
            )
        )
        target = result.scalars().first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target object '{data.target_object_id}' not found",
            )
```

2. After creating the user's relationship and before creating the inverse (~line 74), add FK creation for `references`:

```python
        # Create FK field if this is a references relationship
        if data.cardinality == "references":
            fk_field_id = await self._create_fk_field(source, target, data.name)
            rel.fk_field_id = fk_field_id
            await self.db.flush()
```

3. After creating the inverse (~line 88), add FK creation if the inverse is `references`:

```python
        # Create FK field for inverse if it is a references relationship
        if inverse_cardinality == "references":
            fk_field_id = await self._create_fk_field(target, source, inverse_name)
            inverse.fk_field_id = fk_field_id
            await self.db.flush()
```

**Test:** `cd backend && make test`

**Commit:** `feat(relationships): auto-create FK field on references relationship creation`

### Task 3.3: Wire FK deletion into delete_relationship

**Files:** `src/api/services/relationship.py`

**Steps:**

1. Update `delete_relationship` to also delete the FK field when removing a relationship. After getting the relationship (~line 102), add FK cleanup:

```python
        # Delete FK field if this relationship owns one
        if rel.fk_field_id:
            fk_field = await self.db.get(FieldModel, rel.fk_field_id)
            if fk_field:
                # Delete associations first, then the field
                assocs = await self.db.execute(
                    select(ObjectFieldAssociation).where(
                        ObjectFieldAssociation.field_id == fk_field.id
                    )
                )
                for assoc in assocs.scalars().all():
                    await self.db.delete(assoc)
                await self.db.delete(fk_field)
                await self.db.flush()
```

2. Also handle FK cleanup for the inverse relationship. In the inverse deletion block (~line 112), add before deleting the inverse:

```python
            if inverse and inverse.fk_field_id:
                fk_field = await self.db.get(FieldModel, inverse.fk_field_id)
                if fk_field:
                    assocs = await self.db.execute(
                        select(ObjectFieldAssociation).where(
                            ObjectFieldAssociation.field_id == fk_field.id
                        )
                    )
                    for assoc in assocs.scalars().all():
                        await self.db.delete(assoc)
                    await self.db.delete(fk_field)
                    await self.db.flush()
```

**Test:** `cd backend && make test`

**Commit:** `feat(relationships): auto-delete FK field on relationship deletion`

---

## Part 4: Tests

### Task 4.1: Add tests for FK auto-creation lifecycle

**Files:** `tests/test_api/test_relationship_service.py` (create if needed, or add to existing relationship test file)

**Steps:**

1. Write tests covering:

- **test_references_creates_fk_field**: Creating a `references` relationship auto-creates a `{name}_id` field with role `fk` on the source object
- **test_references_fk_type_matches_target_pk**: The FK field's `type_id` matches the target object's PK field type
- **test_references_fk_field_id_stored_on_relationship**: The relationship's `fk_field_id` points to the created field
- **test_has_many_creates_fk_on_inverse**: Creating a `has_many` relationship auto-creates an FK field on the target (via inferred `references` inverse)
- **test_has_one_creates_fk_on_inverse**: Creating a `has_one` relationship auto-creates an FK field on the target
- **test_many_to_many_no_fk**: Creating a `many_to_many` relationship does NOT create FK fields
- **test_delete_relationship_deletes_fk_field**: Deleting a relationship with `fk_field_id` removes the FK field and association
- **test_delete_relationship_deletes_inverse_fk**: Deleting a relationship also cleans up the inverse's FK field
- **test_fk_field_nullable_default_false**: Auto-created FK fields default to `nullable=False`

2. These tests need to set up objects with PK fields first, then create relationships and verify the FK field lifecycle.

**Test:** `cd backend && make test`

**Commit:** `test(relationships): add FK auto-creation lifecycle tests`

---

## Part 5: Final Verification

### Task 5.1: Run full test suite

**Steps:**

1. Format: `cd backend && poetry run black src/ tests/`
2. Run unit tests: `cd backend && make test`
3. Run E2E tests: `cd backend && make test-e2e`
4. Fix any failures before completing.

**Commit:** (only if formatting needed) `style(relationships): format with black`

---

## Expected API Contract

After implementation, the relationship response includes `fkFieldId`:

**POST /objects/{id}/relationships** (create relationship):
```json
{
  "targetObjectId": "...",
  "name": "customer",
  "cardinality": "references"
}
```

**Response** (both user-created and inverse):
```json
{
  "id": "rel-uuid",
  "sourceObjectId": "product-uuid",
  "targetObjectId": "customer-uuid",
  "name": "customer",
  "cardinality": "references",
  "isInferred": false,
  "inverseId": "inverse-rel-uuid",
  "fkFieldId": "fk-field-uuid"
}
```

The auto-created FK field appears in the object's fields list:
```json
{
  "fieldId": "fk-field-uuid",
  "role": "fk",
  "optional": false,
  "defaultValue": null
}
```

The field entity:
```json
{
  "id": "fk-field-uuid",
  "name": "customer_id",
  "type": "<matches target PK type>",
  "description": "FK reference to Customer"
}
```
