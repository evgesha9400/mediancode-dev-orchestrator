# Relationship Field Fixes — Design Spec

## Context

Median Code generates FastAPI APIs from user-defined object models. Users define objects with fields and relationships (`has_one`, `has_many`, `references`, `many_to_many`) through a visual UI.

## Problem

Three bugs and one hardcoded assumption prevent relationship fields from working correctly end-to-end:

1. **Missing `ConfigDict(from_attributes=True)`** — Generated Pydantic Response schemas lack `from_attributes=True`. Without it, Pydantic v2 cannot serialize SQLAlchemy ORM instances returned by the generated views, causing a runtime crash.

2. **FK ID missing from Create/Update schemas** — `schema_splitter.py` only adds the FK ID field (`author_id`) to the Response schema. The Create schema needs it so users can set the FK when creating records. The Update schema needs it (nullable) so users can change the FK.

3. **Frontend preview ignores relationships** — `buildResponseBodyFromObjectId()` and `buildRequestBodyFromObjectId()` in `examples.ts` iterate only over `objectDef.fields`, ignoring `objectDef.relationships`. The preview doesn't show FK IDs that the backend would generate.

4. **FK type hardcoded to `uuid`** — `schema_splitter.py` hardcodes `type="uuid"` when creating FK ID fields for the response schema. If the target model's PK is `int` or another type, the generated FK field will have the wrong type. The ORM builder (`orm_builder.py`) already does this correctly — it looks up the target PK field type.

## Design Decision

The quorum (Gemini, GPT-5.4, Claude) unanimously recommended:

| Cardinality | Response Schema | Create Schema | Rationale |
|---|---|---|---|
| `references` | `{name}_id: <target_pk_type>` | `{name}_id: <target_pk_type>` | FK is a real column; matches DRF/Rails/Laravel default |
| `has_one` | Nothing | Nothing | FK lives on other side; nesting is behavioral |
| `has_many` | Nothing | Nothing | Reverse relation; behavioral |
| `many_to_many` | Nothing | Nothing | Junction table; behavioral |

No nesting. No user-configurable expansion. The ORM `relationship()` calls provide the navigation paths for post-generation customization.

## Scope

### Backend (4 changes)
1. Add `ConfigDict(from_attributes=True)` to Response schemas — `prepare.py` + `models.mako`
2. Add FK ID to Create schemas — `schema_splitter.py`
3. Add FK ID (nullable) to Update schemas — `schema_splitter.py`
4. Derive FK type from target PK instead of hardcoding `uuid` — `schema_splitter.py`

### Frontend (1 change)
5. Show FK IDs in request/response previews for `references` relationships — `examples.ts`

### Tests
- Update `test_references_fk_id_not_in_create_schema` (currently asserts FK is NOT in Create — invert it)
- Add tests for FK in Update schema
- Add tests for FK type derivation (int PK target)
- Add test for `ConfigDict` in generated output
- Frontend: add/update tests for preview functions
