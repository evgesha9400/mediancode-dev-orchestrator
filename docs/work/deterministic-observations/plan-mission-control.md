# Deterministic Observations — Mission Control Implementation Plan

**Goal:** Add `mc dispatch render/finalize/verify/cancel` commands, simplify `mc observation add`, normalize stage casing, and gate consolidation on finalized dispatches.

**Architecture:** New `dispatches` table + `dispatches.py` logic module + CLI commands. Extend `observations.py` for dispatch-id-only mode and stage normalization. Update consolidation to check for unfinalized dispatches.

**Tech Stack:** Python 3.13+, Typer CLI, SQLite, pytest

**Spec:** `docs/work/deterministic-observations/spec.md` (in orchestrator repo)

**Working directory:** `~/Documents/Projects/mission-control`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `mc/db.py` | Add `dispatches` table to schema |
| Create | `mc/dispatches.py` | Dispatch business logic (render, finalize, verify, cancel) |
| Modify | `mc/observations.py` | Stage normalization, dispatch-id-only add, consolidation gate |
| Modify | `mc/cli.py` | Add `dispatch` command group, update `observation add` |
| Create | `tests/test_dispatches.py` | Tests for dispatch commands |
| Modify | `tests/test_observations.py` | Tests for simplified add, stage normalization, consolidation gate |

---

## Tasks

### Task 1: Add Dispatches Table + Stage Normalization

**Files:**
- Modify: `mc/db.py`
- Modify: `mc/observations.py`
- Modify: `tests/test_observations.py`

- [ ] **Step 1: Add dispatches table to schema**

In `mc/db.py`, add the `dispatches` table creation after the `observations` table:

```python
CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    service_name TEXT NOT NULL REFERENCES services(name),
    agent_name TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    observation_check TEXT,
    created_at TEXT NOT NULL
);
```

Note: column is `service_name` (not `service`) to match the existing `services` table and `feature_services` pattern.

- [ ] **Step 2: Normalize stage to lowercase in observations.py**

In `mc/observations.py`, update `add_observation()` to normalize stage:

```python
stage = stage.lower()
```

Add this as the first line of the function body, before validation.

Also update `consolidate_observations()` to normalize the stage filter parameter the same way, and ensure file naming uses the already-lowercased stage from the DB.

- [ ] **Step 3: Update observation tests for lowercase stage**

In `tests/test_observations.py`, update test assertions that expect title-case stage values (e.g., `"Implement"`) to lowercase (e.g., `"implement"`). The test inputs can stay mixed-case to verify normalization works.

- [ ] **Step 4: Run tests**

```bash
poetry run pytest tests/ -v
```

- [ ] **Step 5: Commit**

```
feat(db): add dispatches table and normalize stage casing

- Add dispatches table for tracking subagent dispatch lifecycle
- Normalize stage to lowercase on write in observations
- Update tests for lowercase stage expectations
```

---

### Task 2: Dispatch Logic Module

**Files:**
- Create: `mc/dispatches.py`
- Create: `tests/test_dispatches.py`

- [ ] **Step 1: Write tests for dispatch logic**

Create `tests/test_dispatches.py` with tests for:

- `create_dispatch()` — creates record with generated ID, returns dispatch dict
- `create_dispatch()` — normalizes stage to lowercase
- `create_dispatch()` — auto-increments attempt for same feature_id/stage/service_name combination
- `render_observation_block()` — returns formatted text with `---BEGIN OBSERVATION CONTEXT---` and `---END OBSERVATION CONTEXT---` markers
- `render_observation_block()` — uses simplified `--dispatch-id` command in template (no positional args)
- `finalize_dispatch()` — sets status to completed, auto-derives `observation_check` from observation count
- `finalize_dispatch()` with recorded observations → `observation_check == "recorded"`
- `finalize_dispatch()` with no observations → `observation_check == "none"`
- `finalize_dispatch()` is idempotent — re-finalizing a completed dispatch updates `observation_check` from current DB state
- `verify_dispatch()` — returns dispatch dict, exits truthy for finalized
- `verify_dispatch()` on missing dispatch — raises ValueError
- `cancel_dispatch()` — sets status to cancelled
- `cancel_dispatch()` is idempotent
- Service-to-scope mapping: `frontend` → `fe`, `backend` → `be`

Use the existing test patterns from `tests/test_observations.py` — `tmp_path` for DB, `conftest.py` fixtures for pipeline/feature setup.

- [ ] **Step 2: Implement dispatches.py**

Create `mc/dispatches.py`:

```python
SERVICE_SCOPE_MAP = {
    "frontend": "fe",
    "backend": "be",
}

def create_dispatch(db, feature_id, stage, service_name, agent_name):
    """Create a dispatch record. Normalizes stage to lowercase. Auto-increments attempt."""

def render_observation_block(dispatch, mc_path):
    """Generate the observation context block text with BEGIN/END markers."""

def finalize_dispatch(db, dispatch_id):
    """Mark dispatch completed. Auto-derive observation_check from observation count. Idempotent."""

def verify_dispatch(db, dispatch_id):
    """Return dispatch record. Raises ValueError if not found."""

def cancel_dispatch(db, dispatch_id):
    """Mark dispatch cancelled. Idempotent."""
```

Key implementation notes:
- `create_dispatch` queries `SELECT MAX(attempt)` for matching feature_id/stage/service_name to auto-increment
- `finalize_dispatch` queries `SELECT COUNT(*) FROM observations WHERE dispatch_id = ?` to auto-derive
- `render_observation_block` uses the simplified `--dispatch-id` command form in the template
- All stage values normalized with `.lower()`

- [ ] **Step 3: Run tests**

```bash
poetry run pytest tests/test_dispatches.py -v
```

- [ ] **Step 4: Commit**

```
feat(dispatch): add dispatch lifecycle logic with render/finalize/verify/cancel
```

---

### Task 3: Dispatch CLI Commands

**Files:**
- Modify: `mc/cli.py`

- [ ] **Step 1: Add dispatch command group**

Add `dispatch_app = typer.Typer(no_args_is_help=True)` and register it as `app.add_typer(dispatch_app, name="dispatch")`.

Add four commands:

```python
@dispatch_app.command("render")
def dispatch_render(
    feature_id: str = typer.Argument(...),
    stage: str = typer.Argument(...),
    service_name: str = typer.Option(..., "--service-name"),
    agent_name: str = typer.Option(..., "--agent-name"),
    mc_path: str = typer.Option(..., "--mc-path"),
):
    """Generate observation context block for a subagent dispatch."""
    # Prints the observation block to stdout (raw text, not JSON)
    # Prints the dispatch record as JSON to stderr for logging

@dispatch_app.command("finalize")
def dispatch_finalize_cmd(
    dispatch_id: str = typer.Argument(...),
):
    """Mark dispatch as completed. Auto-derives observation check from DB."""

@dispatch_app.command("verify")
def dispatch_verify_cmd(
    dispatch_id: str = typer.Argument(...),
):
    """Check whether a dispatch has been finalized."""
    # Exit code 0 if finalized, raise typer.Exit(code=1) if not

@dispatch_app.command("cancel")
def dispatch_cancel_cmd(
    dispatch_id: str = typer.Argument(...),
):
    """Cancel an orphaned or abandoned dispatch."""
```

`dispatch render` prints the observation block to **stdout** (raw text) so the orchestrator can capture it with command substitution. The dispatch record JSON goes to **stderr** for logging.

- [ ] **Step 2: Run full test suite**

```bash
poetry run pytest tests/ -v
```

- [ ] **Step 3: Commit**

```
feat(cli): add dispatch render/finalize/verify/cancel commands
```

---

### Task 4: Simplified observation add + Consolidation Gate

**Files:**
- Modify: `mc/observations.py`
- Modify: `mc/cli.py`
- Modify: `tests/test_observations.py`

- [ ] **Step 1: Write tests**

In `tests/test_observations.py`, add:

- `test_add_observation_from_dispatch` — create dispatch, add observation with only `dispatch_id` + category/title/detail/resolution. Verify inferred fields match dispatch record.
- `test_add_observation_from_dispatch_missing` — raises ValueError for nonexistent dispatch_id
- `test_consolidate_refuses_unfinalized_dispatches` — create a dispatch (status=active), attempt consolidate → raises ValueError with message about unfinalized dispatch
- `test_consolidate_succeeds_with_finalized_dispatches` — create and finalize dispatch, consolidate works normally

- [ ] **Step 2: Add dispatch-id-only observation add**

In `mc/observations.py`, add:

```python
def add_observation_from_dispatch(db, dispatch_id, category, title, detail, resolution):
    """Add observation, inferring context from dispatch record."""
```

Looks up dispatch, maps `service_name` → scope via `SERVICE_SCOPE_MAP`, calls existing `add_observation` with all fields.

- [ ] **Step 3: Update consolidation to check for unfinalized dispatches**

In `mc/observations.py`, update `consolidate_observations()` to query `dispatches` table at the start:

```python
# Check for unfinalized dispatches
unfinalized = db.execute(
    "SELECT id, agent_name FROM dispatches WHERE feature_id = ? AND status = 'active'",
    (feature_id,)
).fetchall()
if unfinalized:
    names = ", ".join(f"{r['id']} ({r['agent_name']})" for r in unfinalized)
    raise ValueError(f"Cannot consolidate: unfinalized dispatches exist: {names}")
```

If a stage filter is provided, also filter dispatches by stage.

- [ ] **Step 4: Update CLI for optional positional args**

In `mc/cli.py`, update `observation_add`:

```python
@observation_app.command("add")
def observation_add(
    feature_id: str = typer.Argument(None),    # Changed from ... to None
    stage: str = typer.Argument(None),          # Changed from ... to None
    scope: str = typer.Option(None, "--scope"),  # Changed from ... to None
    category: str = typer.Option(..., "--category"),
    title: str = typer.Option(..., "--title"),
    detail: str = typer.Option(..., "--detail"),
    resolution: str = typer.Option(..., "--resolution"),
    agent_name: str = typer.Option(None, "--agent-name"),
    dispatch_id: str = typer.Option(None, "--dispatch-id"),
    attempt: int = typer.Option(1, "--attempt"),
):
```

Add manual validation: if `dispatch_id` is provided, use `add_observation_from_dispatch`. Otherwise, require `feature_id`, `stage`, `scope`, `agent_name` (raise `typer.BadParameter` if missing).

- [ ] **Step 5: Run full test suite**

```bash
poetry run pytest tests/ -v
```

- [ ] **Step 6: Commit**

```
feat(observations): dispatch-id-only add and consolidation gate

- Support --dispatch-id mode that infers context from dispatch record
- Block consolidation when unfinalized dispatches exist
- Backward compatible — positional args still work
```

---

### Task 5: Full Test Suite

- [ ] **Step 1: Run all tests**

```bash
poetry run pytest tests/ -v
```

- [ ] **Step 2: Verify no regressions in existing observation tests**

All existing tests should pass with lowercase stage normalization applied.
