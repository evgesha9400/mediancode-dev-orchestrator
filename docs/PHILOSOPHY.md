# Median Code Philosophy

## The Median Principle

Median Code generates the **shortest path to a fully functional, deployable API**. The output is a complete FastAPI application with CDK infrastructure, PostgreSQL database, SQLAlchemy models, Pydantic schemas, and working CRUD endpoints. Users or LLMs can deploy immediately and then tailor to their specific use case.

The name "Median" is literal: we target the **statistical center** of what developers build. Not the simplest possible API, not the most customized — the median. The point equidistant from all possible specific implementations.

## What Median Code IS

- A **boilerplate eliminator** — every line we generate is a line the developer doesn't have to write
- A **structural code generator** — schemas, models, endpoints, infrastructure, configuration
- A **deterministic output** — the same inputs always produce the same code, with no ambiguity
- A **starting point** — 90% complete, designed for the remaining 10% to be filled in by humans or LLMs

## What Median Code IS NOT

- A **full IDE** — we don't replicate code editing experiences (no code editors, no REPLs)
- A **business logic engine** — we don't generate custom logic that only applies to one use case
- A **configuration exhaustor** — we don't expose every possible option; we pick sane defaults

## The Decision Framework

When evaluating whether a feature belongs in Median Code, apply this test:

### 1. Is it structural or behavioral?

| Structural (YES) | Behavioral (NO) |
|---|---|
| Database table definitions | Custom query logic |
| Pydantic model schemas | Business rule validation |
| CRUD endpoint scaffolding | Workflow orchestration |
| Field type declarations | Data transformation pipelines |
| Constraint annotations (`min_length`, `ge`) | Custom validator Python code |
| Project structure and config | Authentication/authorization policies |

**Rule: Generate structure. Leave behavior to post-generation.**

### 2. Is it deterministic?

Can the output be derived mechanically from the input without creative decisions?

- `min_length=5` on a string field → deterministic, one correct output
- "Validate email format" → ambiguous: regex? DNS check? third-party library? How strict?

**Rule: If generating the code requires choosing between equally valid approaches, it's past the median.**

### 3. Does it repeat across >80% of projects?

- Every FastAPI project has models, schemas, and routes → generate it
- Most projects need `@field_validator` for email normalization → common pattern, but the specific validation logic varies
- Some projects need custom model validators → use-case-specific

**Rule: Generate what's universal. Offer templates for what's common. Leave what's specific.**

### 4. Would an LLM generate it faster post-deployment?

If a developer can describe what they want to an LLM and get correct code in seconds, Median Code shouldn't spend UI complexity on it.

- "Add a field validator that strips whitespace and lowercases emails" → an LLM writes this in 3 seconds
- "Set up a FastAPI project with PostgreSQL, Alembic, SQLAlchemy, CDK, proper project structure, health checks, CORS, and 15 interrelated endpoints" → this is what Median Code exists for

**Rule: Automate what's tedious to set up, not what's easy to describe.**

## Applying the Framework: Validators Case Study

### Field Constraints — IN (structural, deterministic)
`min_length`, `ge`, `regex`, `max_items` — these are Pydantic annotations. They're metadata attached to fields. The generated code is always the same: `Field(min_length=5)`. No ambiguity, no creative decisions. Every project uses them.

### Field Validators — TEMPLATE-BASED (common patterns, parameterized)
`@field_validator` patterns like "strip and lowercase" or "must be positive" appear in most projects. The patterns are universal but the specific fields differ. Solution: offer a gallery of common templates that auto-generate the code. No code editor — the user picks a template, the system generates deterministic Python. If their validation doesn't fit a template, they add it post-generation.

### Model Validators — TEMPLATE-BASED (common cross-field patterns, field-mapped)
`@model_validator` patterns like "date range check" or "password confirmation" are common but reference specific field names. Solution: parameterized templates where users map roles to their actual fields via dropdowns. "Select the start date field" → dropdown → "Select the end date field" → dropdown. The system generates the code with correct field names. No code editor.

### Custom Business Logic — OUT (behavioral, use-case-specific)
"If the user is a premium subscriber and the order total exceeds $100, apply a 10% discount but only on weekdays" — this is business logic. It doesn't belong in a code generator. The developer writes this after deployment.

## UI Complexity Budget

Every UI element must justify its existence against the median principle:

- **Forms and dropdowns** are cheap — they configure structural output
- **Code editors** are expensive — they invite behavioral customization beyond the median
- **Template galleries** are the sweet spot — they encode common patterns as configuration, not code authoring
- **Reference tables** (read-only catalogues) are free — they help users understand what's available

When in doubt, ask: "Is this UI helping the user describe structure, or helping them write code?" If it's the latter, it's probably past the median.

## For LLM Implementers

When building features for Median Code:

1. **Check this document first** before deciding what to build and how
2. **Prefer configuration over code authoring** — dropdowns over text editors, templates over blank canvases
3. **Generate deterministic output** — same inputs → same generated Python, always
4. **Don't over-engineer** — the generated code should be clean and simple enough that a developer can read it, understand it, and modify it immediately
5. **Respect the boundary** — Median Code's job ends at "working, deployable API." Everything after that is the developer's domain
