# FK Field Auto-Creation — Design Spec

## Problem

When a user creates a `references` relationship (e.g., Product references Customer), the FK column (`customer_id`) physically exists in the generated database but is invisible in the UI. The FK field is currently "virtual" — synthesized independently in three places at runtime:

1. **Backend `schema_splitter.py`** — injects FK into Pydantic Create/Update/Response schemas
2. **Backend `orm_builder.py`** — synthesizes FK column for SQLAlchemy models
3. **Frontend `examples.ts`** — injects FK into request/response preview JSON

Meanwhile, the UI's `getFkHint()` in `relationships.ts` checks for a *real* FK field and always shows a yellow "missing customer_id" warning because auto-creation was never implemented. This is split truth — three synthesis points producing the same derived fact with no shared contract, and a UI hint that's permanently broken.

## Decision

**Create a real persisted FK Field entity, backend-managed and relationship-owned, with a dedicated `fk` role.**

Quorum consensus: all three models (Gemini, GPT-5.4, Claude) unanimously recommended this approach over UI phantoms or continued virtual synthesis.

## Philosophy Alignment

| Test | Verdict |
|---|---|
| Structural or behavioral? | **Structural** — FK column physically exists in the database |
| Deterministic? | **Yes** — name is `{rel.name}_id`, type matches target PK, no ambiguity |
| >80% of projects? | **Yes** — every `references` relationship needs its FK |
| LLM faster post-deployment? | **No** — FK is a schema-level concern that must exist before first migration |
| UI helping describe structure? | **Yes** — locked field row + nullable toggle is cheap structural configuration |

Framework precedent: Django, Rails, Laravel, Prisma, and SQLAlchemy all treat the FK as a real schema artifact. None use a UI phantom.

## Design

### What Happens When a `references` Relationship is Created

The backend `RelationshipService` (not the frontend) owns FK lifecycle. When a `references` relationship is created — whether user-defined or inferred — the service:

1. Looks up the target object's PK field to determine FK type
2. Creates a `Field` entity: name = `{relationship_name}_id`, type = target PK type
3. Creates an `ObjectFieldAssociation` linking the field to the source object with `role = 'fk'`, `nullable = false` (default)
4. Stores an explicit `fk_field_id` on the `ObjectRelationship` record for ID-based lifecycle tracking

**Rule for inferred relationships:** "If an object has a `references` relationship, that object owns the FK field" — regardless of whether `is_inferred` is true or false. When "Customer has_many Products" creates an inferred "Product references Customer", the FK field `customer_id` is auto-created on Product.

### New FieldRole: `fk`

Add `fk` to `FieldRole` in both frontend (`src/lib/types/index.ts`) and backend (`src/api_craft/models/enums.py`).

**Behavior:**

| Property | Value |
|---|---|
| Schema exposure | `read_write` (same as `writable`) |
| Create schema | Included. Required if `nullable=false`, optional if `nullable=true` |
| Update schema | Included. Always nullable (partial update) |
| Response schema | Included. Nullable matches the field's nullable setting |
| PK | `false` |
| Generated default | None (disallowed) |
| Name | Locked — derived from relationship name |
| Type | Locked — derived from target PK type |
| Nullable | **User-controllable** — the only editable property |
| Available in role dropdown | No — auto-assigned only, not user-selectable |
| Default value | Disallowed |

### Explicit Relationship-to-Field Link

Add `fk_field_id` (nullable UUID) to `ObjectRelationship`. This replaces name-based matching with ID-based tracking for all lifecycle operations.

**Frontend type change:**
```typescript
export interface ObjectRelationship {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  name: string;
  cardinality: Cardinality;
  isInferred: boolean;
  inverseId?: string;
  fkFieldId?: string;  // NEW: links to the auto-created FK field
}
```

**Backend model change:**
Add `fk_field_id` column (nullable FK to `fields.id`) on `object_relationships` table.

### Lifecycle Rules

#### Create
- Triggered by: `RelationshipService.create_relationship()` when cardinality is `references`
- Also triggered for inferred inverse relationships
- FK field name: `{relationship_name}_id`
- FK field type: target object's PK type
- FK field role: `fk`
- FK field nullable: `false` (default)
- Stored link: `relationship.fk_field_id = created_field.id`

#### Rename
- Triggered by: relationship name change (e.g., "customer" → "client")
- Action: auto-rename FK field from `customer_id` → `client_id`
- Constraint: if the FK field is referenced by validators or endpoint mappings, either cascade the rename or block it with a clear error message
- Implementation note: the rename uses `fk_field_id` to find the field, not name matching

#### Target PK Type Change
- Invariant: FK type must equal target PK type
- V1 implementation: **block** PK type changes while inbound `references` relationships exist, with a clear error message listing the affected relationships
- Future: cascade-sync FK field types

#### Nullable Toggle
- User changes nullable on the FK field's `ObjectFieldAssociation`
- No other side effects needed

#### Target/Cardinality Change
- Treat as **replace**, not in-place mutation
- Delete old relationship-owned FK field
- Create new FK field if the new cardinality is `references`

#### Delete Relationship
- Triggered by: `RelationshipService.delete_relationship()`
- Action: delete the FK `ObjectFieldAssociation` and the `Field` entity (if not used by any other object)
- Uses `fk_field_id` to find the field

#### Delete Object
- Existing `CASCADE` on `fields_on_objects.object_id` handles association cleanup
- Orphaned FK `Field` entities should be cleaned up (check `object_associations` count)

### UI Behavior

#### Fields Section
- FK fields appear as locked rows in the object's fields list
- Visual indicators: a link/key icon, "FK" badge, locked name/type inputs
- Only the nullable toggle is interactive
- Position: appended after the last user-defined field, or grouped with the relationship section

#### Field Picker (FieldSelectorDropdown)
- FK fields should be hidden or badged as "managed" so they are not accidentally attached to other objects as free-form fields

#### FK Hint
- `getFkHint()` becomes trivially satisfied — the FK field always exists when a `references` relationship exists
- The hint can be simplified or removed entirely

### Replacing Virtual Synthesis

**Phased approach:**

#### Phase 1: Coexist (ship first)
- Implement FK auto-creation in `RelationshipService`
- The existing dedup guards in `schema_splitter.py` (`if fk_name not in existing_create`), `orm_builder.py`, and `examples.ts` (`if (!(fkName in obj))`) will detect the real field and skip synthesis
- Everything works without removing synthesis code
- Migration script: backfill FK fields for all existing `references` relationships

#### Phase 2: Remove synthesis (after validation)
- Delete `schema_splitter.py` lines 54-96 (FK injection block)
- Change `orm_builder.py` to find existing FK field and annotate with `ForeignKey(...)` instead of synthesizing new column
- Delete `examples.ts` FK preview injection blocks
- Simplify or remove `getFkHint()`
- Replace synthesis code with invariant validation: assert FK field exists for every `references` relationship

## Scope

### Backend
1. Add `fk` to `FieldRole` enum (`enums.py`)
2. Add `fk_field_id` column to `object_relationships` table (`database.py`)
3. Add `fk` to role CHECK constraint on `fields_on_objects` (`database.py`)
4. Map `fk` → `read_write` exposure in `generation.py`
5. Implement FK auto-create/rename/delete in `RelationshipService`
6. Add PK type change blocking when inbound references exist
7. Migration: backfill FK fields for existing relationships
8. Tests for all lifecycle operations

### Frontend
1. Add `fk` to `FieldRole` type, `FIELD_ROLES`, `ROLE_LABELS`, `ROLE_TOOLTIPS` (`types/index.ts`)
2. Add `fkFieldId` to `ObjectRelationship` type (`types/index.ts`)
3. Update `ObjectFormContent.svelte` to render FK fields as locked rows
4. Exclude `fk` from `getAvailableRoles()` dropdown
5. Hide/badge FK fields in `FieldSelectorDropdown`
6. Update `transformRelationship()` in `objects.ts` to include `fkFieldId`
7. Tests

### Phase 2 (deferred)
1. Remove FK synthesis from `schema_splitter.py`
2. Change `orm_builder.py` to annotate existing field
3. Remove FK injection from `examples.ts`
4. Add invariant validation
