# Relationship Graph Mutations — Design Spec

## Problem

Creating or deleting a relationship is a **graph mutation** — a single action that touches multiple entities:

1. **Source object**: Gets a new relationship + FK field reference
2. **Target object**: Gets an inferred inverse relationship + potentially an FK field reference
3. **Fields table**: A new FK FieldModel entity is created (or deleted)

The current API contract treats this as a local mutation:
- `POST /objects/{id}/relationships` returns only `ObjectRelationshipResponse` (the created relationship)
- `DELETE /objects/{id}/relationships/{id}` returns `204 No Content`

The frontend updates `objectsStore` for the source object but:
- `fieldsStore` is NOT updated — `getFieldById(fkFieldId)` returns `undefined`
- The target object in `objectsStore` is NOT updated — its inferred relationship and FK field are stale
- FK field rows render as "Field not found"

## Solution: Reconciler Payload

### Backend

Change relationship endpoints to return a composite payload with all touched entities:

```python
class RelationshipMutationResponse(BaseModel):
    updated_objects: list[ObjectResponse]   # source + target with fresh field/relationship lists
    created_fields: list[FieldResponse]     # newly auto-created FK fields
    deleted_field_ids: list[UUID]           # FK fields removed by relationship deletion

    model_config = ConfigDict(populate_by_name=True)
```

- `POST /objects/{id}/relationships` → returns `RelationshipMutationResponse`
- `DELETE /objects/{id}/relationships/{rel_id}` → returns `RelationshipMutationResponse` (instead of 204)

### Frontend

Create a centralized `reconciler.ts` that applies graph mutation results across all stores atomically:

```typescript
export function applyGraphMutation(result: GraphMutationResult): void {
    // 1. Upsert updated objects into objectsStore
    // 2. Upsert new fields into fieldsStore
    // 3. Remove deleted fields from fieldsStore
}
```

`objectsModel.svelte.ts` calls `applyGraphMutation()` instead of manually patching `objectsStore`.

## Design Principles

- **Pessimistic updates**: The backend is the source of truth for UUIDs, inferred inverses, and FK creation. Don't optimistically create fields in the frontend.
- **Store separation is correct**: Normalized `fieldsStore` and `objectsStore` remain separate. The reconciler bridges them for graph mutations.
- **Single responsibility**: Individual models (`objectsModel`, `fieldsModel`) don't patch each other's stores. The reconciler is the one cross-store updater.
