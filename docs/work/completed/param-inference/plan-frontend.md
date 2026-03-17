# Deterministic Path & Query Parameter Inference -- Frontend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the endpoint form so users explicitly map path/query parameters to target object fields, enabling the backend to generate deterministic filter/lookup code instead of `# TODO` placeholders.

**Architecture:** The endpoint form gains a "target" object selector, replaces the global-field-based path param editor with a target-object-field dropdown, replaces the query params object selector with per-parameter rows (field + operator + pagination checkbox), and hides/shows sections based on response shape (object vs list). All new validation logic lives in a pure-function domain module; the UI reads validation results reactively. New types and operator constants go in `src/lib/types/index.ts`.

**Tech Stack:** SvelteKit 5 (Svelte 5.41+), TypeScript, Tailwind CSS, Vitest (unit tests)

---

## Scope Check

This plan covers **frontend only** -- the UI Behavior section of the design spec. Backend API contract changes (new fields on endpoint payloads) are a separate plan. This plan assumes the backend will accept the new fields once implemented; until then, the frontend will send the new fields and the backend will ignore/store them.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/lib/domain/paramInference.ts` | Pure functions: operator-type compatibility map, auto-suggestion from param names, validation rules 1-7, target resolution |
| `src/lib/components/api-generator/QueryParamRow.svelte` | Single query parameter row: field dropdown + operator dropdown + pagination checkbox + derived type display |
| `src/lib/components/api-generator/TargetObjectSelector.svelte` | Target object selector with conditional visibility logic (auto-inferred for detail, required for list) |
| `tests/unit/lib/domain/paramInference.test.ts` | Unit tests for all 7 validation rules, operator compatibility, auto-suggestions |

### Modified Files

| File | Changes |
|---|---|
| `src/lib/types/index.ts` | Add `QueryParam`, `FilterOperator`, `FILTER_OPERATORS`, `NUMERIC_TYPES`, `COMPARABLE_TYPES`, `STRING_TYPES` types/constants; update `ApiEndpoint` (add `targetObjectId`, replace `queryParamsObjectId` with `queryParams: QueryParam[]`); update `PathParam` (add `field` string field) |
| `src/lib/components/api-generator/ParameterEditor.svelte` | Change from global field dropdown to target-object-field dropdown; add read-only derived type display |
| `src/lib/components/api-generator/QueryParametersEditor.svelte` | Complete rewrite: replace single object selector with list of `QueryParamRow` components; add "Add Query Parameter" button; conditional visibility based on response shape |
| `src/lib/components/api-generator/index.ts` | Add barrel exports for `QueryParamRow`, `TargetObjectSelector` |
| `src/lib/domain/endpointReducer.ts` | Update `reconcilePathParams` to work with target object fields instead of global fields; add `resolveTarget` helper |
| `src/lib/stores/apiDetailState.svelte.ts` | Add target object selection handler; replace query params object handler with per-param CRUD handlers; wire validation errors; update `hasEndpointChanges` and create/save payloads |
| `src/lib/api/endpoints.ts` | Update `CreateEndpointRequest`, `UpdateEndpointRequest`, `EndpointResponse` types with new fields (`targetObjectId`, `queryParams`); update transform functions |
| `src/routes/(dashboard)/apis/[id]/+page.svelte` | Update endpoint form snippet: add `TargetObjectSelector` above path params; pass target object fields to `ParameterEditor`; hide query params section for detail endpoints; display validation errors |
| `tests/unit/lib/domain/endpointReducer.test.ts` | Add tests for updated `reconcilePathParams` with target object |

### Files NOT Changed

- `ObjectEditor.svelte` -- remains the request/response body object selector (separate concern from target)
- `ObjectSelectorDropdown.svelte` -- reused as-is by `TargetObjectSelector`
- `FieldSelectorDropdown.svelte` -- not used (we build a simpler target-field dropdown inline since the available fields come from the target object, not the global fields store)
- `src/lib/domain/mutations.ts` -- no changes; the existing `createEndpointAction`/`updateEndpointAction` already pass through the full request payload

---

## Chunk 1: Types, Constants, and Validation Domain Logic

### Task 1: Add New Types and Constants to `src/lib/types/index.ts`

**Files:**
- Modify: `src/lib/types/index.ts`

- [ ] **Step 1: Add filter operator type and constants**

In `src/lib/types/index.ts`, add after the `RESPONSE_SHAPES` line:

```typescript
// Filter operator types for query parameter inference
export type FilterOperator = 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'like' | 'ilike' | 'in';

export const FILTER_OPERATORS: FilterOperator[] = ['eq', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'in'];

// Type categories for operator compatibility (values are type names from the types store)
export const NUMERIC_TYPES = ['int', 'float', 'Decimal'] as const;
export const COMPARABLE_TYPES = [...NUMERIC_TYPES, 'date', 'datetime', 'time'] as const;
export const STRING_TYPES = ['str'] as const;

// Map of which operators are valid for which type categories
export const OPERATOR_TYPE_COMPATIBILITY: Record<FilterOperator, 'all' | 'comparable' | 'string'> = {
  eq: 'all',
  gte: 'comparable',
  lte: 'comparable',
  gt: 'comparable',
  lt: 'comparable',
  like: 'string',
  ilike: 'string',
  in: 'all'
};
```

- [ ] **Step 2: Add `QueryParam` interface**

In `src/lib/types/index.ts`, add after the `PathParam` interface:

```typescript
/**
 * Query parameter with field mapping and filter operator.
 * When `pagination` is true, `field` and `operator` are unused.
 */
export interface QueryParam {
  name: string;
  field: string;       // field name on the target object (empty string when pagination)
  operator: FilterOperator; // filter operation (defaults to 'eq' when pagination)
  pagination: boolean; // true for limit/offset-style params
}
```

- [ ] **Step 3: Update `PathParam` interface**

Change the existing `PathParam` to include the field name reference:

```typescript
/**
 * Path parameter referencing a field on the target object.
 * `fieldId` is kept for backward compat during migration; `field` is the
 * target-object field name used by the new inference system.
 */
export interface PathParam {
  name: string;
  fieldId: string;     // legacy: global field ID (kept for backward compat)
  field: string;       // NEW: field name on the target object
}
```

- [ ] **Step 4: Update `ApiEndpoint` interface**

Add `targetObjectId` and `queryParams` to `ApiEndpoint`:

```typescript
export interface ApiEndpoint {
  id: string;
  apiId: string;
  method: HttpMethod;
  path: string;
  description: string;
  tagName?: string;
  pathParams: PathParam[];
  queryParams: QueryParam[];           // NEW: replaces queryParamsObjectId
  queryParamsObjectId?: string;        // DEPRECATED: kept for backward compat during migration
  targetObjectId?: string;             // NEW: the object all params resolve against
  objectId?: string;
  useEnvelope: boolean;
  responseShape: ResponseShape;
  expanded?: boolean;
}
```

- [ ] **Step 5: Run type check to see what breaks**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run svelte-check --tsconfig ./tsconfig.json 2>&1 | head -80`

Expected: Type errors in files that construct `PathParam` or `ApiEndpoint` without the new fields. Note these files for later tasks.

- [ ] **Step 6: Commit**

```
feat(types): add param inference types and update endpoint model
```

---

### Task 2: Create `paramInference.ts` Domain Module

**Files:**
- Create: `src/lib/domain/paramInference.ts`
- Create: `tests/unit/lib/domain/paramInference.test.ts`

- [ ] **Step 1: Write failing tests for `getCompatibleOperators`**

Create `tests/unit/lib/domain/paramInference.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getCompatibleOperators } from '$lib/domain/paramInference';

describe('getCompatibleOperators', () => {
  it('returns all operators for "all" types like str', () => {
    const ops = getCompatibleOperators('str');
    expect(ops).toContain('eq');
    expect(ops).toContain('in');
    expect(ops).toContain('like');
    expect(ops).toContain('ilike');
    expect(ops).not.toContain('gte');
  });

  it('returns comparable + universal operators for int', () => {
    const ops = getCompatibleOperators('int');
    expect(ops).toContain('eq');
    expect(ops).toContain('gte');
    expect(ops).toContain('lte');
    expect(ops).toContain('gt');
    expect(ops).toContain('lt');
    expect(ops).toContain('in');
    expect(ops).not.toContain('like');
    expect(ops).not.toContain('ilike');
  });

  it('returns comparable + universal operators for datetime', () => {
    const ops = getCompatibleOperators('datetime');
    expect(ops).toContain('gte');
    expect(ops).toContain('eq');
    expect(ops).not.toContain('like');
  });

  it('returns comparable + universal operators for date', () => {
    const ops = getCompatibleOperators('date');
    expect(ops).toContain('lte');
    expect(ops).toContain('in');
    expect(ops).not.toContain('ilike');
  });

  it('returns eq and in for bool', () => {
    const ops = getCompatibleOperators('bool');
    expect(ops).toContain('eq');
    expect(ops).toContain('in');
    expect(ops).not.toContain('gte');
    expect(ops).not.toContain('like');
  });

  it('returns eq and in for uuid', () => {
    const ops = getCompatibleOperators('uuid');
    expect(ops).toContain('eq');
    expect(ops).toContain('in');
    expect(ops).not.toContain('lt');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: FAIL -- module not found

- [ ] **Step 3: Implement `getCompatibleOperators`**

Create `src/lib/domain/paramInference.ts`:

```typescript
// src/lib/domain/paramInference.ts
//
// Pure functions for parameter inference: operator compatibility,
// auto-suggestions, and validation rules 1-7 from the design spec.

import type { FilterOperator } from '$lib/types';
import {
  FILTER_OPERATORS,
  COMPARABLE_TYPES,
  STRING_TYPES,
  OPERATOR_TYPE_COMPATIBILITY
} from '$lib/types';

/**
 * Returns the list of operators compatible with a given field type name.
 *
 * - Comparable types (numeric, date, datetime, time): eq, gte, lte, gt, lt, in
 * - String types (str): eq, like, ilike, in
 * - All other types: eq, in
 */
export function getCompatibleOperators(fieldTypeName: string): FilterOperator[] {
  const isComparable = (COMPARABLE_TYPES as readonly string[]).includes(fieldTypeName);
  const isString = (STRING_TYPES as readonly string[]).includes(fieldTypeName);

  return FILTER_OPERATORS.filter(op => {
    const compat = OPERATOR_TYPE_COMPATIBILITY[op];
    if (compat === 'all') return true;
    if (compat === 'comparable') return isComparable;
    if (compat === 'string') return isString;
    return false;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: All PASS

- [ ] **Step 5: Commit**

```
feat(domain): add operator-type compatibility logic
```

---

### Task 3: Add Auto-Suggestion Logic

**Files:**
- Modify: `src/lib/domain/paramInference.ts`
- Modify: `tests/unit/lib/domain/paramInference.test.ts`

- [ ] **Step 1: Write failing tests for `suggestFieldAndOperator`**

Append to the test file:

```typescript
import { suggestFieldAndOperator } from '$lib/domain/paramInference';

describe('suggestFieldAndOperator', () => {
  const fieldNames = ['price', 'quantity', 'category', 'name', 'created_at', 'id'];

  it('suggests field: price, operator: gte for "min_price"', () => {
    const result = suggestFieldAndOperator('min_price', fieldNames);
    expect(result).toEqual({ field: 'price', operator: 'gte' });
  });

  it('suggests field: quantity, operator: lte for "max_quantity"', () => {
    const result = suggestFieldAndOperator('max_quantity', fieldNames);
    expect(result).toEqual({ field: 'quantity', operator: 'lte' });
  });

  it('suggests field: category, operator: eq for "category"', () => {
    const result = suggestFieldAndOperator('category', fieldNames);
    expect(result).toEqual({ field: 'category', operator: 'eq' });
  });

  it('returns null when no field name matches', () => {
    const result = suggestFieldAndOperator('foobar', fieldNames);
    expect(result).toBeNull();
  });

  it('returns null for empty param name', () => {
    const result = suggestFieldAndOperator('', fieldNames);
    expect(result).toBeNull();
  });

  it('suggests field: created_at, operator: gte for "after_created_at"', () => {
    const result = suggestFieldAndOperator('after_created_at', fieldNames);
    expect(result).toEqual({ field: 'created_at', operator: 'gte' });
  });

  it('suggests field: created_at, operator: lte for "before_created_at"', () => {
    const result = suggestFieldAndOperator('before_created_at', fieldNames);
    expect(result).toEqual({ field: 'created_at', operator: 'lte' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: FAIL -- function not found

- [ ] **Step 3: Implement `suggestFieldAndOperator`**

Add to `src/lib/domain/paramInference.ts`:

```typescript
/**
 * Suggestion result from auto-inference based on param naming conventions.
 */
export interface ParamSuggestion {
  field: string;
  operator: FilterOperator;
}

/**
 * Prefixes that imply a specific operator when stripped to reveal a field name.
 * Order matters: longer/more-specific prefixes first.
 */
const PREFIX_RULES: { prefix: string; operator: FilterOperator }[] = [
  { prefix: 'min_', operator: 'gte' },
  { prefix: 'max_', operator: 'lte' },
  { prefix: 'after_', operator: 'gte' },
  { prefix: 'before_', operator: 'lte' },
];

/**
 * Auto-suggest a field name and operator based on a query parameter's name.
 *
 * This is a UI convenience -- not schema validation. The user can always
 * accept or override the suggestion.
 *
 * Returns null if no suggestion can be made.
 */
export function suggestFieldAndOperator(
  paramName: string,
  targetFieldNames: string[]
): ParamSuggestion | null {
  if (!paramName) return null;

  // Try prefix rules first (min_price -> field: price, operator: gte)
  for (const rule of PREFIX_RULES) {
    if (paramName.startsWith(rule.prefix)) {
      const candidate = paramName.slice(rule.prefix.length);
      if (candidate && targetFieldNames.includes(candidate)) {
        return { field: candidate, operator: rule.operator };
      }
    }
  }

  // Exact match (category -> field: category, operator: eq)
  if (targetFieldNames.includes(paramName)) {
    return { field: paramName, operator: 'eq' };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: All PASS

- [ ] **Step 5: Commit**

```
feat(domain): add auto-suggestion for param field and operator
```

---

### Task 4: Add Validation Rules 1-7

**Files:**
- Modify: `src/lib/domain/paramInference.ts`
- Modify: `tests/unit/lib/domain/paramInference.test.ts`

- [ ] **Step 1: Write failing tests for `validateEndpointParams`**

Append to the test file:

```typescript
import { validateEndpointParams } from '$lib/domain/paramInference';
import type { ResponseShape, PathParam, QueryParam } from '$lib/types';

// Helper to build a minimal "resolved target" for validation
interface TargetField {
  name: string;
  type: string;
  isPk: boolean;
}

function validate(opts: {
  responseShape: ResponseShape;
  targetObjectId?: string;
  objectId?: string;
  targetFields?: TargetField[];
  pathParams?: { name: string; field: string }[];
  queryParams?: { name: string; field: string; operator: string; pagination: boolean }[];
}) {
  return validateEndpointParams({
    responseShape: opts.responseShape,
    targetObjectId: opts.targetObjectId,
    objectId: opts.objectId,
    targetFields: opts.targetFields ?? [],
    pathParams: (opts.pathParams ?? []).map(p => ({
      name: p.name,
      fieldId: '',
      field: p.field
    })),
    queryParams: (opts.queryParams ?? []).map(q => ({
      name: q.name,
      field: q.field,
      operator: q.operator as any,
      pagination: q.pagination
    }))
  });
}

describe('validateEndpointParams', () => {
  // Rule 1: Target object is known
  describe('Rule 1: target is known', () => {
    it('passes for detail endpoint with objectId (target inferred)', () => {
      const errors = validate({
        responseShape: 'object',
        objectId: 'obj-1',
        targetFields: [{ name: 'id', type: 'uuid', isPk: true }],
        pathParams: [{ name: 'id', field: 'id' }]
      });
      expect(errors).toEqual([]);
    });

    it('fails for list endpoint without targetObjectId', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: undefined,
        targetFields: []
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 1 })
      );
    });
  });

  // Rule 2: Every param field exists on target
  describe('Rule 2: field exists on target', () => {
    it('fails when path param field does not exist on target', () => {
      const errors = validate({
        responseShape: 'object',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'id', type: 'uuid', isPk: true }],
        pathParams: [{ name: 'store_id', field: 'store_id' }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 2, param: 'store_id' })
      );
    });

    it('fails when query param field does not exist on target', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'price', type: 'float', isPk: false }],
        queryParams: [{ name: 'category', field: 'nonexistent', operator: 'eq', pagination: false }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 2, param: 'category' })
      );
    });

    it('skips validation for pagination params', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'id', type: 'uuid', isPk: true }],
        queryParams: [{ name: 'limit', field: '', operator: 'eq', pagination: true }]
      });
      const rule2Errors = errors.filter(e => e.rule === 2);
      expect(rule2Errors).toEqual([]);
    });
  });

  // Rule 3: Detail endpoint last path param = PK
  describe('Rule 3: detail last param is PK', () => {
    it('passes when last path param maps to PK', () => {
      const errors = validate({
        responseShape: 'object',
        targetObjectId: 'obj-1',
        targetFields: [
          { name: 'store_id', type: 'uuid', isPk: false },
          { name: 'id', type: 'uuid', isPk: true }
        ],
        pathParams: [
          { name: 'store_id', field: 'store_id' },
          { name: 'item_id', field: 'id' }
        ]
      });
      const rule3 = errors.filter(e => e.rule === 3);
      expect(rule3).toEqual([]);
    });

    it('fails when last path param does not map to PK', () => {
      const errors = validate({
        responseShape: 'object',
        targetObjectId: 'obj-1',
        targetFields: [
          { name: 'store_id', type: 'uuid', isPk: false },
          { name: 'id', type: 'uuid', isPk: true }
        ],
        pathParams: [{ name: 'store_id', field: 'store_id' }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 3 })
      );
    });
  });

  // Rule 4: Detail endpoint no query params
  describe('Rule 4: detail has no query params', () => {
    it('fails when detail endpoint has query params', () => {
      const errors = validate({
        responseShape: 'object',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'id', type: 'uuid', isPk: true }],
        pathParams: [{ name: 'id', field: 'id' }],
        queryParams: [{ name: 'q', field: 'id', operator: 'eq', pagination: false }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 4 })
      );
    });
  });

  // Rule 5: List endpoint no path param = PK
  describe('Rule 5: list path param not PK', () => {
    it('fails when list endpoint has path param mapped to PK', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [
          { name: 'id', type: 'uuid', isPk: true },
          { name: 'price', type: 'float', isPk: false }
        ],
        pathParams: [{ name: 'product_id', field: 'id' }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 5 })
      );
    });
  });

  // Rule 6: Operator compatible with field type
  describe('Rule 6: operator-type compatibility', () => {
    it('fails when using gte on str field', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'name', type: 'str', isPk: false }],
        queryParams: [{ name: 'min_name', field: 'name', operator: 'gte', pagination: false }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 6, param: 'min_name' })
      );
    });

    it('passes when using ilike on str field', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'name', type: 'str', isPk: false }],
        queryParams: [{ name: 'search', field: 'name', operator: 'ilike', pagination: false }]
      });
      const rule6 = errors.filter(e => e.rule === 6);
      expect(rule6).toEqual([]);
    });

    it('fails when using like on int field', () => {
      const errors = validate({
        responseShape: 'list',
        targetObjectId: 'obj-1',
        targetFields: [{ name: 'count', type: 'int', isPk: false }],
        queryParams: [{ name: 'count_like', field: 'count', operator: 'like', pagination: false }]
      });
      expect(errors).toContainEqual(
        expect.objectContaining({ rule: 6, param: 'count_like' })
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: FAIL -- `validateEndpointParams` not found

- [ ] **Step 3: Implement `validateEndpointParams`**

Add to `src/lib/domain/paramInference.ts`:

```typescript
import type { FilterOperator, PathParam, QueryParam, ResponseShape } from '$lib/types';

/**
 * A field on the resolved target object, as seen by validation.
 */
export interface TargetField {
  name: string;
  type: string;
  isPk: boolean;
}

/**
 * Input for endpoint param validation.
 */
export interface ValidationInput {
  responseShape: ResponseShape;
  targetObjectId?: string;
  objectId?: string;         // the response/body object (used for detail target inference)
  targetFields: TargetField[];
  pathParams: PathParam[];
  queryParams: QueryParam[];
}

/**
 * A single validation error with a rule number and human-readable message.
 */
export interface ValidationError {
  rule: number;
  message: string;
  param?: string; // the parameter name that triggered the error, if applicable
}

/**
 * Validate an endpoint's parameter configuration against all 7 rules.
 * Returns an empty array when everything is valid.
 */
export function validateEndpointParams(input: ValidationInput): ValidationError[] {
  const errors: ValidationError[] = [];
  const {
    responseShape,
    targetObjectId,
    objectId,
    targetFields,
    pathParams,
    queryParams
  } = input;

  const isDetail = responseShape === 'object';
  const isList = responseShape === 'list';

  // Rule 1: Target object is known
  const effectiveTarget = isDetail ? (targetObjectId ?? objectId) : targetObjectId;
  if (!effectiveTarget) {
    errors.push({
      rule: 1,
      message: isList
        ? 'List endpoints require a target object'
        : 'Target object could not be determined'
    });
    // Cannot validate further without a target
    return errors;
  }

  // Rule 2: Every param field exists on target
  const fieldNameSet = new Set(targetFields.map(f => f.name));

  for (const pp of pathParams) {
    if (pp.field && !fieldNameSet.has(pp.field)) {
      errors.push({
        rule: 2,
        message: `Field "${pp.field}" does not exist on the target object`,
        param: pp.name
      });
    }
  }

  for (const qp of queryParams) {
    if (qp.pagination) continue; // pagination params have no field
    if (qp.field && !fieldNameSet.has(qp.field)) {
      errors.push({
        rule: 2,
        message: `Field "${qp.field}" does not exist on the target object`,
        param: qp.name
      });
    }
  }

  // Rule 3: Detail endpoint -- last path param maps to PK
  if (isDetail && pathParams.length > 0) {
    const lastParam = pathParams[pathParams.length - 1];
    const lastField = targetFields.find(f => f.name === lastParam.field);
    if (!lastField || !lastField.isPk) {
      errors.push({
        rule: 3,
        message: "Detail endpoint's identifying param must map to the primary key",
        param: lastParam.name
      });
    }
  }

  // Rule 4: Detail endpoint -- no query params
  if (isDetail && queryParams.length > 0) {
    errors.push({
      rule: 4,
      message: 'Detail endpoints cannot have query parameters'
    });
  }

  // Rule 5: List endpoint -- no path param maps to PK
  if (isList) {
    const pkFieldNames = new Set(targetFields.filter(f => f.isPk).map(f => f.name));
    for (const pp of pathParams) {
      if (pp.field && pkFieldNames.has(pp.field)) {
        errors.push({
          rule: 5,
          message: `Path param "${pp.name}" maps to PK field "${pp.field}" -- use a detail endpoint instead`,
          param: pp.name
        });
      }
    }
  }

  // Rule 6: Operator compatible with field type
  for (const qp of queryParams) {
    if (qp.pagination) continue;
    const field = targetFields.find(f => f.name === qp.field);
    if (!field) continue; // already caught by rule 2
    const compatible = getCompatibleOperators(field.type);
    if (!compatible.includes(qp.operator)) {
      errors.push({
        rule: 6,
        message: `Operator "${qp.operator}" is not valid for field type "${field.type}"`,
        param: qp.name
      });
    }
  }

  // Rule 7 is auto-enforced: param type is derived from field type, never user-editable

  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: All PASS

- [ ] **Step 5: Commit**

```
feat(domain): add endpoint param validation rules 1-7
```

---

### Task 5: Add `resolveTargetFields` Helper

This function resolves a target object ID into the `TargetField[]` array needed by the validator, bridging the stores to the pure domain logic.

**Files:**
- Modify: `src/lib/domain/paramInference.ts`
- Modify: `tests/unit/lib/domain/paramInference.test.ts`

- [ ] **Step 1: Write failing test for `resolveTargetFields`**

```typescript
import { resolveTargetFields } from '$lib/domain/paramInference';
import type { ObjectDefinition, Field } from '$lib/types';

describe('resolveTargetFields', () => {
  const fields: Field[] = [
    { id: 'f-1', namespaceId: 'ns', name: 'id', type: 'uuid', container: null, constraints: [], validators: [], usedInApis: [] },
    { id: 'f-2', namespaceId: 'ns', name: 'price', type: 'float', container: null, constraints: [], validators: [], usedInApis: [] },
    { id: 'f-3', namespaceId: 'ns', name: 'name', type: 'str', container: null, constraints: [], validators: [], usedInApis: [] }
  ];

  const objects: ObjectDefinition[] = [
    {
      id: 'obj-1', namespaceId: 'ns', name: 'Product', fields: [
        { fieldId: 'f-1', optional: false, isPk: true, appears: 'both' },
        { fieldId: 'f-2', optional: false, isPk: false, appears: 'both' },
        { fieldId: 'f-3', optional: true, isPk: false, appears: 'both' }
      ],
      relationships: [], validators: [], usedInApis: []
    }
  ];

  it('resolves fields from target object', () => {
    const result = resolveTargetFields('obj-1', objects, fields);
    expect(result).toEqual([
      { name: 'id', type: 'uuid', isPk: true },
      { name: 'price', type: 'float', isPk: false },
      { name: 'name', type: 'str', isPk: false }
    ]);
  });

  it('returns empty array for unknown object', () => {
    const result = resolveTargetFields('unknown', objects, fields);
    expect(result).toEqual([]);
  });

  it('skips fields that cannot be resolved', () => {
    const sparseObjects: ObjectDefinition[] = [
      {
        id: 'obj-2', namespaceId: 'ns', name: 'Sparse', fields: [
          { fieldId: 'f-1', optional: false, isPk: true, appears: 'both' },
          { fieldId: 'f-missing', optional: false, isPk: false, appears: 'both' }
        ],
        relationships: [], validators: [], usedInApis: []
      }
    ];
    const result = resolveTargetFields('obj-2', sparseObjects, fields);
    expect(result).toEqual([{ name: 'id', type: 'uuid', isPk: true }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

- [ ] **Step 3: Implement `resolveTargetFields`**

Add to `src/lib/domain/paramInference.ts`:

```typescript
import type { ObjectDefinition, Field } from '$lib/types';

/**
 * Resolve a target object ID into a flat array of TargetField objects.
 * This bridges the store data (objects + fields) to the pure validation input.
 */
export function resolveTargetFields(
  targetObjectId: string,
  objects: ObjectDefinition[],
  fields: Field[]
): TargetField[] {
  const obj = objects.find(o => o.id === targetObjectId);
  if (!obj) return [];

  const result: TargetField[] = [];
  for (const ref of obj.fields) {
    const field = fields.find(f => f.id === ref.fieldId);
    if (!field) continue;
    result.push({
      name: field.name,
      type: field.type,
      isPk: ref.isPk
    });
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/paramInference.test.ts`

Expected: All PASS

- [ ] **Step 5: Commit**

```
feat(domain): add resolveTargetFields helper for validation bridge
```

---

## Chunk 2: API Layer and Endpoint Reducer Updates

### Task 6: Update API Layer Types and Transforms

**Files:**
- Modify: `src/lib/api/endpoints.ts`

- [ ] **Step 1: Update `EndpointResponse` with new backend fields**

Add to the `EndpointResponse` interface and update transforms:

```typescript
interface QueryParamResponse {
  name: string;
  field: string;
  operator: string;
  pagination: boolean;
}

interface EndpointResponse {
  id: string;
  apiId: string;
  method: string;
  path: string;
  description: string;
  tagName: string | null;
  pathParams: PathParamResponse[];
  queryParams: QueryParamResponse[];         // NEW
  queryParamsObjectId: string | null;        // kept for backward compat
  targetObjectId: string | null;             // NEW
  objectId: string | null;
  useEnvelope: boolean;
  responseShape: string;
}
```

Update `PathParamResponse`:

```typescript
interface PathParamResponse {
  name: string;
  fieldId: string;
  field: string;   // NEW: field name on target object
}
```

Update `transformParameter`:

```typescript
function transformParameter(response: PathParamResponse): PathParam {
  return {
    name: response.name,
    fieldId: response.fieldId,
    field: response.field ?? ''
  };
}
```

Add `transformQueryParam`:

```typescript
import type { ApiEndpoint, PathParam, QueryParam, HttpMethod, ResponseShape, FilterOperator } from '$lib/types';

function transformQueryParam(response: QueryParamResponse): QueryParam {
  return {
    name: response.name,
    field: response.field ?? '',
    operator: (response.operator as FilterOperator) ?? 'eq',
    pagination: response.pagination ?? false
  };
}
```

Update `transformEndpoint`:

```typescript
function transformEndpoint(response: EndpointResponse): ApiEndpoint {
  return {
    id: response.id,
    apiId: response.apiId,
    method: response.method as HttpMethod,
    path: response.path,
    description: response.description,
    tagName: response.tagName ?? undefined,
    pathParams: response.pathParams.map(transformParameter),
    queryParams: (response.queryParams ?? []).map(transformQueryParam),
    queryParamsObjectId: response.queryParamsObjectId ?? undefined,
    targetObjectId: response.targetObjectId ?? undefined,
    objectId: response.objectId ?? undefined,
    useEnvelope: response.useEnvelope,
    responseShape: response.responseShape as ResponseShape,
    expanded: false
  };
}
```

- [ ] **Step 2: Update request types**

Update `CreateEndpointRequest` and `UpdateEndpointRequest`:

```typescript
export interface CreateEndpointRequest {
  apiId: string;
  method: HttpMethod;
  path: string;
  description?: string;
  tagName?: string;
  pathParams?: { name: string; fieldId: string; field: string }[];
  queryParams?: { name: string; field: string; operator: string; pagination: boolean }[];
  queryParamsObjectId?: string;   // deprecated, kept for compat
  targetObjectId?: string;
  objectId?: string;
  useEnvelope?: boolean;
  responseShape?: ResponseShape;
}

export interface UpdateEndpointRequest {
  method?: HttpMethod;
  path?: string;
  description?: string;
  tagName?: string | null;
  pathParams?: { name: string; fieldId: string; field: string }[];
  queryParams?: { name: string; field: string; operator: string; pagination: boolean }[];
  queryParamsObjectId?: string | null;  // deprecated
  targetObjectId?: string | null;
  objectId?: string | null;
  useEnvelope?: boolean;
  responseShape?: ResponseShape;
}
```

- [ ] **Step 3: Run type check**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run svelte-check --tsconfig ./tsconfig.json 2>&1 | head -60`

Note remaining type errors for next tasks.

- [ ] **Step 4: Commit**

```
feat(api): update endpoint API layer with param inference fields
```

---

### Task 7: Update Endpoint Reducer

**Files:**
- Modify: `src/lib/domain/endpointReducer.ts`
- Modify: `tests/unit/lib/domain/endpointReducer.test.ts`

- [ ] **Step 1: Update `reconcilePathParams` to include `field` property**

In `endpointReducer.ts`, update `reconcilePathParams` so new path params get `field: ''`:

```typescript
export function reconcilePathParams(
  newPath: string,
  existingParams: PathParam[]
): PathReconciliationResult {
  const path = newPath.startsWith('/') ? newPath : '/' + newPath;
  const paramNames = extractPathParameters(path);
  const fields = get(fieldsStore);

  const pathParams: PathParam[] = paramNames.map(paramName => {
    const existing = existingParams.find(p => p.name === paramName);
    if (existing) return existing;

    const matchedField = fields.find(f => f.name === paramName);
    return { name: paramName, fieldId: matchedField?.id ?? '', field: '' };
  });

  return { path, pathParams };
}
```

- [ ] **Step 2: Update `normalizeEndpoint` to include `queryParams` default**

```typescript
export function normalizeEndpoint(endpoint: ApiEndpoint): ApiEndpoint {
  return {
    ...endpoint,
    responseShape: endpoint.responseShape ?? 'object',
    queryParams: endpoint.queryParams ?? []
  };
}
```

- [ ] **Step 3: Update `buildDuplicateEndpoint` to copy new fields**

```typescript
export function buildDuplicateEndpoint(original: ApiEndpoint): ApiEndpoint {
  const normalized = normalizeEndpoint(original);
  return {
    ...deepClone(normalized),
    id: generateId('endpoint'),
    path: `${original.path}-copy`,
    expanded: false,
    pathParams: original.pathParams.map(p => ({ ...p })),
    queryParams: (original.queryParams ?? []).map(q => ({ ...q }))
  };
}
```

- [ ] **Step 4: Update existing tests**

In `tests/unit/lib/domain/endpointReducer.test.ts`, update the `makeEndpoint` helper:

```typescript
function makeEndpoint(overrides: Partial<ApiEndpoint> = {}): ApiEndpoint {
  return {
    id: 'ep-1',
    apiId: 'api-1',
    path: '/items',
    method: 'GET',
    description: '',
    pathParams: [],
    queryParams: [],
    useEnvelope: false,
    responseShape: 'object',
    expanded: true,
    ...overrides
  };
}
```

Update the `reconcilePathParams` test that checks structure to expect the `field` property:

```typescript
it('extracts parameter names from path', () => {
  const result = reconcilePathParams('/users/{user_id}', []);
  expect(result.pathParams).toEqual([{ name: 'user_id', fieldId: '', field: '' }]);
});
```

Add a test for `buildDuplicateEndpoint` copying `queryParams`:

```typescript
it('deep copies queryParams', () => {
  const original = makeEndpoint({
    queryParams: [{ name: 'min_price', field: 'price', operator: 'gte' as any, pagination: false }]
  });
  const dup = buildDuplicateEndpoint(original);
  expect(dup.queryParams).toEqual(original.queryParams);
  expect(dup.queryParams[0]).not.toBe(original.queryParams[0]);
});
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run tests/unit/lib/domain/endpointReducer.test.ts`

Expected: All PASS

- [ ] **Step 6: Commit**

```
feat(domain): update endpoint reducer for param inference fields
```

---

## Chunk 3: State Container and Svelte Components

### Task 8: Update `apiDetailState.svelte.ts`

**Files:**
- Modify: `src/lib/stores/apiDetailState.svelte.ts`

This is a large task because the state container orchestrates all endpoint editing. The changes are:
1. Add target object selection handler
2. Replace `handleSelectQueryParamsObject` with per-param CRUD
3. Wire validation through `validateEndpointParams`
4. Update `CREATE_DEFAULTS` and `hasEndpointChanges`
5. Update create/save payloads to include new fields

- [ ] **Step 1: Add imports for new modules**

At the top of `apiDetailState.svelte.ts`, add:

```typescript
import type { QueryParam, FilterOperator } from '$lib/types';
import {
  validateEndpointParams,
  resolveTargetFields,
  type ValidationError
} from '$lib/domain/paramInference';
import { objectsStore } from './objects';
import { fieldsStore } from './fields';
```

- [ ] **Step 2: Add `objectsState` and `fieldsState` reactive subscriptions**

Inside `createApiDetailState`, after the existing `fromStore` calls:

```typescript
const objectsState = fromStore(objectsStore);
const fieldsState = fromStore(fieldsStore);
let allObjects = $derived(objectsState.current);
let allFields = $derived(fieldsState.current);
```

- [ ] **Step 3: Add derived `targetFields` and `validationErrors`**

After the `endpoints` derived:

```typescript
// Resolved target object ID: for detail endpoints, inferred from objectId
let effectiveTargetId = $derived.by(() => {
  if (!editedEndpoint) return undefined;
  if (editedEndpoint.responseShape === 'object') {
    return editedEndpoint.targetObjectId ?? editedEndpoint.objectId;
  }
  return editedEndpoint.targetObjectId;
});

// Fields on the target object (for populating dropdowns)
let targetFields = $derived.by(() => {
  if (!effectiveTargetId) return [];
  return resolveTargetFields(effectiveTargetId, allObjects, allFields);
});

// Live validation errors
let validationErrors = $derived.by((): ValidationError[] => {
  if (!editedEndpoint) return [];
  return validateEndpointParams({
    responseShape: editedEndpoint.responseShape,
    targetObjectId: editedEndpoint.targetObjectId,
    objectId: editedEndpoint.objectId,
    targetFields,
    pathParams: editedEndpoint.pathParams,
    queryParams: editedEndpoint.queryParams ?? []
  });
});
```

- [ ] **Step 4: Update `CREATE_DEFAULTS` and `hasEndpointChanges`**

```typescript
const CREATE_DEFAULTS = {
  method: 'GET' as const,
  path: '/',
  description: '',
  tagName: undefined as string | undefined,
  pathParams: [] as PathParam[],
  queryParams: [] as QueryParam[],
  targetObjectId: undefined as string | undefined,
  queryParamsObjectId: undefined as string | undefined,
  objectId: undefined as string | undefined,
  useEnvelope: true,
  responseShape: 'object' as const
};
```

Update `hasEndpointChanges` to include new fields:

```typescript
let hasEndpointChanges = $derived.by(() => {
  if (!editedEndpoint) return false;
  if (isCreating) {
    return editedEndpoint.method !== CREATE_DEFAULTS.method
      || editedEndpoint.path !== CREATE_DEFAULTS.path
      || editedEndpoint.description !== CREATE_DEFAULTS.description
      || editedEndpoint.tagName !== CREATE_DEFAULTS.tagName
      || editedEndpoint.pathParams.length !== CREATE_DEFAULTS.pathParams.length
      || (editedEndpoint.queryParams ?? []).length !== CREATE_DEFAULTS.queryParams.length
      || editedEndpoint.targetObjectId !== CREATE_DEFAULTS.targetObjectId
      || editedEndpoint.queryParamsObjectId !== CREATE_DEFAULTS.queryParamsObjectId
      || editedEndpoint.objectId !== CREATE_DEFAULTS.objectId
      || editedEndpoint.useEnvelope !== CREATE_DEFAULTS.useEnvelope
      || editedEndpoint.responseShape !== CREATE_DEFAULTS.responseShape;
  }
  if (!selectedEndpoint) return false;
  return JSON.stringify(editedEndpoint) !== JSON.stringify(selectedEndpoint);
});
```

- [ ] **Step 5: Add target object selection handler**

```typescript
function handleSelectTarget(objectId: string | undefined): void {
  if (!editedEndpoint) return;
  editedEndpoint = {
    ...editedEndpoint,
    targetObjectId: objectId,
    // Clear path param field mappings when target changes (fields may no longer exist)
    pathParams: editedEndpoint.pathParams.map(p => ({ ...p, field: '' })),
    // Clear query params when target changes
    queryParams: []
  };
}
```

- [ ] **Step 6: Add query param CRUD handlers**

```typescript
function handleAddQueryParam(): void {
  if (!editedEndpoint) return;
  const newParam: QueryParam = {
    name: '',
    field: '',
    operator: 'eq',
    pagination: false
  };
  editedEndpoint = {
    ...editedEndpoint,
    queryParams: [...(editedEndpoint.queryParams ?? []), newParam]
  };
}

function handleUpdateQueryParam(index: number, updates: Partial<QueryParam>): void {
  if (!editedEndpoint) return;
  const qps = [...(editedEndpoint.queryParams ?? [])];
  qps[index] = { ...qps[index], ...updates };
  editedEndpoint = { ...editedEndpoint, queryParams: qps };
}

function handleRemoveQueryParam(index: number): void {
  if (!editedEndpoint) return;
  const qps = [...(editedEndpoint.queryParams ?? [])];
  qps.splice(index, 1);
  editedEndpoint = { ...editedEndpoint, queryParams: qps };
}
```

- [ ] **Step 7: Update `handlePathParamUpdate` to set `field` instead of just `fieldId`**

```typescript
function handlePathParamFieldSelect(paramName: string, fieldName: string): void {
  if (!editedEndpoint) return;
  const updatedParams = editedEndpoint.pathParams.map(p =>
    p.name === paramName ? { ...p, field: fieldName } : p
  );
  editedEndpoint = { ...editedEndpoint, pathParams: updatedParams };
}
```

Keep `handlePathParamUpdate` for backward compat but mark deprecated.

- [ ] **Step 8: Update `handleAddEndpoint` defaults**

```typescript
function handleAddEndpoint(): void {
  closeEditDrawer();
  isCreating = true;
  selectedEndpoint = null;
  editedEndpoint = {
    id: '',
    apiId,
    method: CREATE_DEFAULTS.method,
    path: CREATE_DEFAULTS.path,
    description: CREATE_DEFAULTS.description,
    pathParams: [],
    queryParams: [],
    useEnvelope: CREATE_DEFAULTS.useEnvelope,
    responseShape: CREATE_DEFAULTS.responseShape,
    expanded: false
  };
  endpointDrawerOpen = true;
  tagInputValue = '';
  tagDropdownOpen = false;
}
```

- [ ] **Step 9: Update create/save payloads to include new fields**

In `handleCreateEndpoint`:

```typescript
const result = await createEndpointAction({
  apiId,
  method: editedEndpoint.method,
  path: editedEndpoint.path,
  description: editedEndpoint.description,
  tagName: editedEndpoint.tagName,
  pathParams: editedEndpoint.pathParams,
  queryParams: editedEndpoint.queryParams ?? [],
  targetObjectId: editedEndpoint.targetObjectId,
  queryParamsObjectId: editedEndpoint.queryParamsObjectId,
  objectId: editedEndpoint.objectId,
  useEnvelope: editedEndpoint.useEnvelope,
  responseShape: editedEndpoint.responseShape
});
```

In `handleSaveEndpoint`:

```typescript
const result = await updateEndpointAction(editedEndpoint.id, {
  method: editedEndpoint.method,
  path: editedEndpoint.path,
  description: editedEndpoint.description,
  tagName: editedEndpoint.tagName ?? null,
  pathParams: editedEndpoint.pathParams,
  queryParams: editedEndpoint.queryParams ?? [],
  targetObjectId: editedEndpoint.targetObjectId ?? null,
  queryParamsObjectId: editedEndpoint.queryParamsObjectId ?? null,
  objectId: editedEndpoint.objectId ?? null,
  useEnvelope: editedEndpoint.useEnvelope,
  responseShape: editedEndpoint.responseShape
});
```

In `handleDuplicateEndpoint`:

```typescript
const result = await createEndpointAction({
  apiId: original.apiId,
  method: original.method,
  path: original.path + '-copy',
  description: original.description,
  tagName: original.tagName,
  pathParams: original.pathParams.map(p => ({ ...p })),
  queryParams: (original.queryParams ?? []).map(q => ({ ...q })),
  targetObjectId: original.targetObjectId,
  queryParamsObjectId: original.queryParamsObjectId,
  objectId: original.objectId,
  useEnvelope: original.useEnvelope,
  responseShape: original.responseShape
});
```

- [ ] **Step 10: Update the returned state API**

Add new getters and handlers to the return object:

```typescript
// Target object
get effectiveTargetId() { return effectiveTargetId; },
get targetFields() { return targetFields; },
get validationErrors() { return validationErrors; },
handleSelectTarget,

// Query param CRUD
handleAddQueryParam,
handleUpdateQueryParam,
handleRemoveQueryParam,

// Updated path param handler
handlePathParamFieldSelect,
```

Also update the `ApiDetailState` interface at the top of the file to include these new members.

- [ ] **Step 11: Run type check**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run svelte-check --tsconfig ./tsconfig.json 2>&1 | head -80`

Fix any remaining type errors.

- [ ] **Step 12: Commit**

```
feat(state): add target object and query param handlers to API detail state
```

---

### Task 9: Create `TargetObjectSelector.svelte`

**Files:**
- Create: `src/lib/components/api-generator/TargetObjectSelector.svelte`
- Modify: `src/lib/components/api-generator/index.ts`

- [ ] **Step 1: Create the component**

Create `src/lib/components/api-generator/TargetObjectSelector.svelte`:

```svelte
<script module lang="ts">
  import type { ObjectDefinition, ResponseShape } from '$lib/types';

  export interface TargetObjectSelectorProps {
    endpointNamespaceId: string;
    responseShape: ResponseShape;
    objectId?: string;
    targetObjectId?: string;
    onSelectTarget: (objectId: string | undefined) => void;
    onCreateNewObject?: () => void;
  }
</script>

<script lang="ts">
  import { objectsStore, getObjectById } from '$lib/stores/objects';
  import ObjectSelectorDropdown from './ObjectSelectorDropdown.svelte';

  interface Props extends TargetObjectSelectorProps {}

  let {
    endpointNamespaceId,
    responseShape,
    objectId,
    targetObjectId,
    onSelectTarget,
    onCreateNewObject
  }: Props = $props();

  const isDetail = $derived(responseShape === 'object');

  // For detail endpoints, target is inferred from the response object
  const effectiveTargetId = $derived(isDetail ? (targetObjectId ?? objectId) : targetObjectId);
  const effectiveTarget = $derived(effectiveTargetId ? getObjectById(effectiveTargetId) : undefined);

  // Filter objects to namespace
  const namespacedObjects = $derived($objectsStore.filter(obj => obj.namespaceId === endpointNamespaceId));
</script>

<div>
  <h3 class="text-sm text-mono-300 mb-2 flex items-center font-medium">
    <i class="fa-solid fa-bullseye mr-2"></i>
    Target Object
  </h3>

  {#if isDetail}
    <!-- Detail: target is inferred from the response object -->
    {#if effectiveTarget}
      <div class="px-3 py-2 bg-mono-800 border border-mono-700 flex items-center space-x-2">
        <i class="fa-solid fa-cube text-mono-400 text-xs"></i>
        <span class="font-mono text-sm text-mono-300">{effectiveTarget.name}</span>
        <span class="text-xs text-mono-400">(inferred from response object)</span>
      </div>
    {:else}
      <div class="px-3 py-2 bg-mono-800 border border-mono-700">
        <p class="text-xs text-mono-400">Select a response object below to set the target</p>
      </div>
    {/if}
  {:else}
    <!-- List: user must explicitly select target -->
    <ObjectSelectorDropdown
      availableObjects={namespacedObjects}
      selectedObjectId={targetObjectId}
      onSelect={onSelectTarget}
      onCreateNew={onCreateNewObject}
      placeholder="Select target object (required for list endpoints)..."
    />
    {#if !targetObjectId}
      <p class="text-xs text-red-400 mt-1">List endpoints require a target object</p>
    {/if}
  {/if}
</div>
```

- [ ] **Step 2: Add barrel export**

In `src/lib/components/api-generator/index.ts`, add:

```typescript
export { default as TargetObjectSelector } from './TargetObjectSelector.svelte';
export type { TargetObjectSelectorProps } from './TargetObjectSelector.svelte';
```

- [ ] **Step 3: Commit**

```
feat(ui): add TargetObjectSelector component
```

---

### Task 10: Create `QueryParamRow.svelte`

**Files:**
- Create: `src/lib/components/api-generator/QueryParamRow.svelte`
- Modify: `src/lib/components/api-generator/index.ts`

- [ ] **Step 1: Create the component**

Create `src/lib/components/api-generator/QueryParamRow.svelte`:

```svelte
<script module lang="ts">
  import type { QueryParam, FilterOperator } from '$lib/types';
  import type { TargetField } from '$lib/domain/paramInference';

  export interface QueryParamRowProps {
    param: QueryParam;
    targetFields: TargetField[];
    onUpdate: (updates: Partial<QueryParam>) => void;
    onRemove: () => void;
    onSuggest?: (suggestion: { field: string; operator: FilterOperator }) => void;
  }
</script>

<script lang="ts">
  import { getCompatibleOperators, suggestFieldAndOperator } from '$lib/domain/paramInference';
  import { FILTER_OPERATORS } from '$lib/types';

  interface Props extends QueryParamRowProps {}

  let { param, targetFields, onUpdate, onRemove, onSuggest }: Props = $props();

  // Available operators filtered by the selected field's type
  const selectedField = $derived(targetFields.find(f => f.name === param.field));
  const availableOperators = $derived(
    selectedField ? getCompatibleOperators(selectedField.type) : FILTER_OPERATORS
  );

  // Derived type display (read-only)
  const derivedType = $derived.by(() => {
    if (param.pagination) return 'int';
    if (!selectedField) return '';
    if (param.operator === 'in') return `list[${selectedField.type}]`;
    return selectedField.type;
  });

  // Auto-suggest when name changes
  let lastSuggestedName = $state('');

  function handleNameInput(e: Event): void {
    const name = (e.target as HTMLInputElement).value;
    onUpdate({ name });

    // Only suggest once per unique name
    if (name && name !== lastSuggestedName && !param.pagination) {
      const fieldNames = targetFields.map(f => f.name);
      const suggestion = suggestFieldAndOperator(name, fieldNames);
      if (suggestion) {
        lastSuggestedName = name;
        onSuggest?.(suggestion);
      }
    }
  }

  function handlePaginationToggle(): void {
    const newPagination = !param.pagination;
    if (newPagination) {
      onUpdate({ pagination: true, field: '', operator: 'eq' });
    } else {
      onUpdate({ pagination: false });
    }
  }
</script>

<div class="flex items-start gap-2 py-1.5 border-b border-mono-700 last:border-b-0">
  <!-- Name input -->
  <div class="w-28 shrink-0">
    <input
      type="text"
      value={param.name}
      oninput={handleNameInput}
      placeholder="param_name"
      class="w-full px-2 py-1 text-xs font-mono border border-mono-600 bg-mono-900 text-mono-100 focus:ring-2 focus:ring-green-400 focus:border-transparent"
    />
  </div>

  {#if param.pagination}
    <!-- Pagination mode: simplified display -->
    <div class="flex-1 flex items-center gap-2">
      <span class="text-xs text-mono-400 bg-mono-800 px-2 py-1 rounded">pagination</span>
      <span class="text-xs text-mono-400 bg-mono-800 px-1.5 py-0.5 rounded">int</span>
    </div>
  {:else}
    <!-- Field dropdown -->
    <div class="flex-1 min-w-0">
      <select
        value={param.field}
        onchange={(e) => {
          const newField = (e.target as HTMLSelectElement).value;
          onUpdate({ field: newField });
          // Reset operator if incompatible with new field type
          const newFieldDef = targetFields.find(f => f.name === newField);
          if (newFieldDef) {
            const compat = getCompatibleOperators(newFieldDef.type);
            if (!compat.includes(param.operator)) {
              onUpdate({ field: newField, operator: compat[0] ?? 'eq' });
            }
          }
        }}
        class="w-full px-2 py-1 text-xs border border-mono-600 bg-mono-900 text-mono-100 focus:ring-2 focus:ring-green-400 focus:border-transparent"
      >
        <option value="">Select field...</option>
        {#each targetFields as f (f.name)}
          <option value={f.name}>{f.name} ({f.type})</option>
        {/each}
      </select>
    </div>

    <!-- Operator dropdown -->
    <div class="w-20 shrink-0">
      <select
        value={param.operator}
        onchange={(e) => onUpdate({ operator: (e.target as HTMLSelectElement).value as FilterOperator })}
        class="w-full px-2 py-1 text-xs border border-mono-600 bg-mono-900 text-mono-100 focus:ring-2 focus:ring-green-400 focus:border-transparent"
      >
        {#each availableOperators as op (op)}
          <option value={op}>{op}</option>
        {/each}
      </select>
    </div>

    <!-- Derived type (read-only) -->
    {#if derivedType}
      <div class="w-20 shrink-0 flex items-center">
        <span class="text-xs text-mono-400 bg-mono-800 px-1.5 py-1 rounded truncate" title={derivedType}>
          {derivedType}
        </span>
      </div>
    {/if}
  {/if}

  <!-- Pagination checkbox -->
  <label class="flex items-center gap-1 shrink-0 cursor-pointer" title="Pagination parameter (limit/offset)">
    <input
      type="checkbox"
      checked={param.pagination}
      onchange={handlePaginationToggle}
      class="w-3.5 h-3.5 accent-green-400"
    />
    <span class="text-xs text-mono-400">Pag</span>
  </label>

  <!-- Remove button -->
  <button
    type="button"
    onclick={onRemove}
    class="shrink-0 text-mono-400 hover:text-red-400 transition-colors p-1"
    title="Remove parameter"
  >
    <i class="fa-solid fa-xmark text-xs"></i>
  </button>
</div>
```

- [ ] **Step 2: Add barrel export**

In `src/lib/components/api-generator/index.ts`, add:

```typescript
export { default as QueryParamRow } from './QueryParamRow.svelte';
export type { QueryParamRowProps } from './QueryParamRow.svelte';
```

- [ ] **Step 3: Commit**

```
feat(ui): add QueryParamRow component for per-parameter editing
```

---

### Task 11: Update `ParameterEditor.svelte` for Target Object Fields

**Files:**
- Modify: `src/lib/components/api-generator/ParameterEditor.svelte`

The current `ParameterEditor` takes `availableFields: Field[]` from the global fields store and uses `fieldId` to link. The new version takes `targetFields: TargetField[]` from the resolved target object and uses the `field` (name) property.

- [ ] **Step 1: Update props and internal logic**

Replace the entire `ParameterEditor.svelte` content:

```svelte
<script module lang="ts">
  import type { TargetField } from '$lib/domain/paramInference';

  export interface ParameterEditorProps {
    paramName: string;
    fieldName: string;
    targetFields: TargetField[];
    onFieldSelect: (fieldName: string) => void;
  }
</script>

<script lang="ts">
  interface Props extends ParameterEditorProps {}

  let { paramName, fieldName, targetFields, onFieldSelect }: Props = $props();

  // Find the currently selected field
  const selectedField = $derived(targetFields.find(f => f.name === fieldName));

  // Derived type (read-only display)
  const derivedType = $derived(selectedField?.type ?? '');
</script>

<div class="flex items-center space-x-2 py-1.5">
  <!-- Param name (read-only, extracted from path) -->
  <div class="w-32 px-2 py-1 text-xs bg-mono-800 border border-mono-700 text-mono-300 font-mono shrink-0">
    {paramName}
  </div>

  <!-- Field selector (dropdown from target object fields) -->
  <div class="flex-1">
    <select
      value={fieldName}
      onchange={(e) => onFieldSelect((e.target as HTMLSelectElement).value)}
      class="w-full px-2 py-1 text-xs border border-mono-600 bg-mono-900 text-mono-100 focus:ring-2 focus:ring-green-400 focus:border-transparent"
    >
      <option value="">Select field...</option>
      {#each targetFields as f (f.name)}
        <option value={f.name}>
          {f.name} ({f.type}){f.isPk ? ' [PK]' : ''}
        </option>
      {/each}
    </select>
  </div>

  <!-- Derived type (read-only) -->
  {#if derivedType}
    <div class="shrink-0">
      <span class="text-xs text-mono-400 bg-mono-800 px-1.5 py-0.5 rounded">{derivedType}</span>
    </div>
  {/if}

  <!-- Operator (always eq for path params, shown as read-only label) -->
  <div class="shrink-0">
    <span class="text-xs text-mono-400 bg-mono-800 px-1.5 py-0.5 rounded">eq</span>
  </div>
</div>
```

Note: This is a breaking change to `ParameterEditorProps`. The old props (`fieldId`, `availableFields: Field[]`, `onCreateNewField`) are removed. The call site in `+page.svelte` must be updated (Task 12).

- [ ] **Step 2: Update barrel export types**

The type export in `index.ts` already re-exports `ParameterEditorProps` -- no change needed since it re-exports from the `.svelte` file.

- [ ] **Step 3: Commit**

```
refactor(ui): update ParameterEditor to use target object fields
```

---

### Task 12: Rewrite `QueryParametersEditor.svelte`

**Files:**
- Modify: `src/lib/components/api-generator/QueryParametersEditor.svelte`

The current component shows an object selector. The new version shows a list of `QueryParamRow` components with an "Add" button, and is only visible for list endpoints.

- [ ] **Step 1: Rewrite the component**

```svelte
<script module lang="ts">
  import type { QueryParam, FilterOperator, ResponseShape } from '$lib/types';
  import type { TargetField, ValidationError } from '$lib/domain/paramInference';

  export interface QueryParametersEditorProps {
    queryParams: QueryParam[];
    targetFields: TargetField[];
    responseShape: ResponseShape;
    validationErrors: ValidationError[];
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<QueryParam>) => void;
    onRemove: (index: number) => void;
  }
</script>

<script lang="ts">
  import QueryParamRow from './QueryParamRow.svelte';

  interface Props extends QueryParametersEditorProps {}

  let {
    queryParams,
    targetFields,
    responseShape,
    validationErrors,
    onAdd,
    onUpdate,
    onRemove
  }: Props = $props();

  const isDetail = $derived(responseShape === 'object');

  // Filter validation errors for query params (rules 4, 6)
  const queryErrors = $derived(validationErrors.filter(e => e.rule === 4 || e.rule === 6));
</script>

{#if !isDetail}
  <div>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm text-mono-300 flex items-center font-medium">
        <i class="fa-solid fa-filter mr-2"></i>
        Query Parameters
      </h3>
      <button
        type="button"
        onclick={onAdd}
        class="text-xs text-mono-400 hover:text-mono-100 transition-colors flex items-center space-x-1"
      >
        <i class="fa-solid fa-plus text-xs"></i>
        <span>Add</span>
      </button>
    </div>

    {#if queryParams.length === 0}
      <div class="px-3 py-2 bg-mono-950 rounded border border-mono-700">
        <p class="text-xs text-mono-400">No query parameters. Click "Add" to define filters for this list endpoint.</p>
      </div>
    {:else}
      <div class="px-3 py-1 bg-mono-950 rounded border border-mono-700">
        <!-- Column headers -->
        <div class="flex items-center gap-2 py-1 border-b border-mono-700 text-[10px] text-mono-500 uppercase tracking-wider">
          <div class="w-28 shrink-0">Name</div>
          <div class="flex-1">Field</div>
          <div class="w-20 shrink-0">Operator</div>
          <div class="w-20 shrink-0">Type</div>
          <div class="w-12 shrink-0">Pag</div>
          <div class="w-6 shrink-0"></div>
        </div>
        {#each queryParams as param, i (i)}
          <QueryParamRow
            {param}
            {targetFields}
            onUpdate={(updates) => onUpdate(i, updates)}
            onRemove={() => onRemove(i)}
            onSuggest={(suggestion) => onUpdate(i, { field: suggestion.field, operator: suggestion.operator })}
          />
        {/each}
      </div>
    {/if}

    <!-- Validation errors -->
    {#if queryErrors.length > 0}
      <div class="mt-2 space-y-1">
        {#each queryErrors as error}
          <p class="text-xs text-red-400 flex items-center gap-1">
            <i class="fa-solid fa-triangle-exclamation"></i>
            {error.message}
          </p>
        {/each}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 2: Commit**

```
refactor(ui): rewrite QueryParametersEditor for per-param editing
```

---

### Task 13: Update `+page.svelte` Endpoint Form

**Files:**
- Modify: `src/routes/(dashboard)/apis/[id]/+page.svelte`

This task wires all new components into the endpoint form snippet.

- [ ] **Step 1: Update imports**

Replace/add imports at the top of the script:

```typescript
import {
  DrawerStack,
  Pill,
  FormField,
  FormLabel,
  EndpointItem,
  ParameterEditor,
  QueryParametersEditor,
  ObjectEditor,
  GenerateModal,
  TargetObjectSelector
} from '$lib/components';
```

- [ ] **Step 2: Replace `availableFields` with target-derived fields**

Remove the old `availableFields` derived (which filtered global fields by namespace). The target fields now come from `apiState.targetFields`.

Delete:
```typescript
const availableFields = $derived(
  $fieldsStore.filter(f => f.namespaceId === apiState.apiNamespaceId)
);
```

Keep the `fieldsStore` import only if it's still needed elsewhere (for inline field creation, which is separate from param editing). Check before removing.

- [ ] **Step 3: Update the `endpointFormContent` snippet**

Replace the endpoint form content snippet. Key changes:

**Add `TargetObjectSelector` before Path Parameters:**

```svelte
<!-- Target Object -->
<TargetObjectSelector
  endpointNamespaceId={apiState.apiNamespaceId}
  responseShape={apiState.editedEndpoint.responseShape}
  objectId={apiState.editedEndpoint.objectId}
  targetObjectId={apiState.editedEndpoint.targetObjectId}
  onSelectTarget={apiState.handleSelectTarget}
  onCreateNewObject={() => openObjectCreate('body')}
/>
```

**Update Path Parameters to use `targetFields` and `field` name:**

```svelte
<!-- Path Parameters -->
<div>
  <h3 class="text-sm text-mono-300 mb-2 flex items-center font-medium">
    <i class="fa-solid fa-link mr-2"></i>
    Path Parameters
  </h3>
  {#if apiState.editedEndpoint.pathParams.length === 0}
    <div class="px-3 py-1 bg-mono-950 rounded border border-mono-700">
      <p class="text-xs text-mono-400">No path parameters. Add parameters to your URL path using <code class="bg-mono-800 px-1 rounded">{`{param_name}`}</code></p>
    </div>
  {:else}
    <div class="px-3 py-1 bg-mono-950 rounded border border-mono-700 space-y-1">
      {#each apiState.editedEndpoint.pathParams as param (param.name)}
        <ParameterEditor
          paramName={param.name}
          fieldName={param.field}
          targetFields={apiState.targetFields}
          onFieldSelect={(fieldName) => apiState.handlePathParamFieldSelect(param.name, fieldName)}
        />
      {/each}
    </div>
  {/if}
</div>
```

**Replace `QueryParametersEditor` invocation:**

```svelte
<!-- Query Parameters (only visible for list endpoints) -->
<QueryParametersEditor
  queryParams={apiState.editedEndpoint.queryParams ?? []}
  targetFields={apiState.targetFields}
  responseShape={apiState.editedEndpoint.responseShape}
  validationErrors={apiState.validationErrors}
  onAdd={apiState.handleAddQueryParam}
  onUpdate={apiState.handleUpdateQueryParam}
  onRemove={apiState.handleRemoveQueryParam}
/>
```

**Display validation errors (non-query-specific ones):**

After the Object Editor section, add a general validation error display:

```svelte
<!-- Validation Errors -->
{#if apiState.validationErrors.length > 0}
  {@const generalErrors = apiState.validationErrors.filter(e => ![4, 6].includes(e.rule))}
  {#if generalErrors.length > 0}
    <div class="p-3 bg-red-400/10 border border-red-400/30 rounded space-y-1">
      <p class="text-xs text-red-400 font-medium">Validation Issues:</p>
      {#each generalErrors as error}
        <p class="text-xs text-red-400 flex items-center gap-1">
          <i class="fa-solid fa-triangle-exclamation"></i>
          {error.message}{error.param ? ` (${error.param})` : ''}
        </p>
      {/each}
    </div>
  {/if}
{/if}
```

- [ ] **Step 4: Run type check**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run svelte-check --tsconfig ./tsconfig.json 2>&1 | head -80`

Fix any remaining errors.

- [ ] **Step 5: Run all unit tests**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run`

Expected: All PASS

- [ ] **Step 6: Commit**

```
feat(ui): wire param inference into endpoint form
```

---

## Chunk 4: Backward Compatibility, Edge Cases, and Final Verification

### Task 14: Handle Backward Compatibility for Existing Endpoints

Existing endpoints have `pathParams` with `fieldId` but no `field`, and `queryParamsObjectId` but no `queryParams`. The transforms need graceful defaults.

**Files:**
- Modify: `src/lib/api/endpoints.ts`
- Modify: `src/lib/domain/endpointReducer.ts`

- [ ] **Step 1: Ensure transform handles missing fields gracefully**

In `endpoints.ts`, the transform already uses `?? ''` and `?? []` fallbacks. Verify that:
- `response.pathParams[].field` defaults to `''` when absent
- `response.queryParams` defaults to `[]` when absent
- `response.targetObjectId` defaults to `undefined` when absent

This should already be covered by the Step 1 of Task 6 transforms. Verify by reading the file.

- [ ] **Step 2: Add migration note in `normalizeEndpoint`**

In `endpointReducer.ts`:

```typescript
export function normalizeEndpoint(endpoint: ApiEndpoint): ApiEndpoint {
  return {
    ...endpoint,
    responseShape: endpoint.responseShape ?? 'object',
    queryParams: endpoint.queryParams ?? [],
    pathParams: endpoint.pathParams.map(p => ({
      ...p,
      field: p.field ?? ''  // ensure field exists for legacy data
    }))
  };
}
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run`

Expected: All PASS

- [ ] **Step 4: Commit**

```
fix(domain): ensure backward compat for legacy endpoint data
```

---

### Task 15: Verify Section Visibility Based on Response Shape

**Files:**
- No new files -- manual verification

- [ ] **Step 1: Start dev server and test detail endpoint**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run dev`

Navigate to an API detail page. Create or edit an endpoint:
1. Set response shape to "Object"
2. Verify: Query Parameters section is **hidden**
3. Verify: Target Object shows "inferred from response object"
4. Set a path parameter and verify field dropdown shows target object fields
5. Verify: derived type displays next to the selected field

- [ ] **Step 2: Test list endpoint**

1. Set response shape to "List of Objects"
2. Verify: Target Object selector appears and is **required**
3. Verify: Query Parameters section is **visible**
4. Add a query parameter, verify field dropdown populates from target
5. Verify: operator dropdown filters based on field type
6. Check pagination checkbox -- field/operator should hide
7. Verify: derived type shows `int` for pagination params

- [ ] **Step 3: Test auto-suggestion**

1. On a list endpoint with target object that has a `price` field
2. Add a query parameter and type `min_price`
3. Verify: field auto-fills to `price`, operator to `gte`

- [ ] **Step 4: Verify validation errors display**

1. On a detail endpoint, verify no query params can be added
2. On a list endpoint, map a path param to the PK field -- verify error
3. Use `gte` operator on a `str` field -- verify error

- [ ] **Step 5: Commit any fixes**

Only if manual testing reveals issues. Otherwise skip.

---

### Task 16: Final Type Check and Test Suite

**Files:**
- No new files

- [ ] **Step 1: Run full type check**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bun run svelte-check --tsconfig ./tsconfig.json`

Expected: 0 errors

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx vitest run`

Expected: All PASS

- [ ] **Step 3: Run smoke tests**

Run: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend && bunx playwright test --project=smoke`

Expected: All PASS (no regressions in auth flow or dashboard rendering)

- [ ] **Step 4: Final commit if any cleanup needed**

```
chore(ui): clean up param inference implementation
```

---

## Summary of All Files Changed

| Category | File | Action |
|---|---|---|
| Types | `src/lib/types/index.ts` | Modify |
| Domain | `src/lib/domain/paramInference.ts` | **Create** |
| Domain | `src/lib/domain/endpointReducer.ts` | Modify |
| API | `src/lib/api/endpoints.ts` | Modify |
| State | `src/lib/stores/apiDetailState.svelte.ts` | Modify |
| Component | `src/lib/components/api-generator/TargetObjectSelector.svelte` | **Create** |
| Component | `src/lib/components/api-generator/QueryParamRow.svelte` | **Create** |
| Component | `src/lib/components/api-generator/ParameterEditor.svelte` | Modify |
| Component | `src/lib/components/api-generator/QueryParametersEditor.svelte` | Modify |
| Component | `src/lib/components/api-generator/index.ts` | Modify |
| Route | `src/routes/(dashboard)/apis/[id]/+page.svelte` | Modify |
| Test | `tests/unit/lib/domain/paramInference.test.ts` | **Create** |
| Test | `tests/unit/lib/domain/endpointReducer.test.ts` | Modify |
