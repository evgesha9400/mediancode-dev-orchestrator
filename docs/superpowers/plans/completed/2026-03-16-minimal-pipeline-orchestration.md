# Minimal Pipeline Orchestration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Mission Control as a Python CLI and build a dispatcher skill that orchestrates scoped frontend/backend agents through plan→verify→implement→verify.

**Architecture:** MC CLI is a Python package (`mc`) installed via Poetry. It wraps SQLite operations behind `typer` commands that output JSON. The orchestrator's `dispatch-pipeline` skill calls MC CLI via Bash, then dispatches Claude Code subagents for the actual work. The existing TS MCP server code in `repos/server/` serves as the reference implementation — the Python port is a near-1:1 translation of the service layer, minus `notes` and `document_paths`.

**Tech Stack:** Python 3.13+, typer, PyYAML, sqlite3 (stdlib), pytest

**Repos:**
- MC CLI: `/Users/evgesha/Documents/Projects/mission-control/` (new Python project at repo root)
- Orchestrator: `/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/`

**Reference spec:** `docs/specs/2026-03-16-minimal-pipeline-orchestration-design.md`

---

## Chunk 1: MC CLI — Project Setup & Core Commands

### Task 1: Project Scaffolding

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `pyproject.toml`
- Create: `mc/__init__.py`
- Create: `mc/cli.py`
- Create: `mc/db.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[tool.poetry]
name = "mission-control"
version = "0.1.0"
description = "Domain-agnostic pipeline orchestration CLI"
packages = [{include = "mc"}]

[tool.poetry.scripts]
mc = "mc.cli:app"

[tool.poetry.dependencies]
python = "^3.13"
typer = "^0.15"
pyyaml = "^6.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

- [ ] **Step 2: Create `mc/__init__.py`**

```python
# mc/__init__.py
```

Empty file. Package marker only.

- [ ] **Step 3: Create `mc/db.py`**

Port of `repos/server/src/db.ts`. Schema matches the design spec (6 tables, no `notes`, no `document_paths`).

```python
"""Database connection, schema management, and shared helpers."""

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

STAGE_SENTINEL = "__stage__"

SCHEMA = """
CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    current_stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_progress (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '__stage__',
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(feature_id, stage, step)
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id),
    stage TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '__stage__',
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
    name TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    stack TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_services (
    feature_id TEXT NOT NULL REFERENCES features(id),
    service_name TEXT NOT NULL REFERENCES services(name),
    status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY (feature_id, service_name)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id() -> str:
    return uuid.uuid4().hex[:8]


def get_db(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or os.environ.get("MC_DB", "./db/mission-control.db")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
```

- [ ] **Step 4: Create `mc/cli.py` with basic structure**

```python
"""Mission Control CLI — domain-agnostic pipeline orchestration."""

import json
import typer

app = typer.Typer(name="mc", no_args_is_help=True)
pipeline_app = typer.Typer(no_args_is_help=True)
feature_app = typer.Typer(no_args_is_help=True)
step_app = typer.Typer(no_args_is_help=True)
service_app = typer.Typer(no_args_is_help=True)
artifact_app = typer.Typer(no_args_is_help=True)

app.add_typer(pipeline_app, name="pipeline")
app.add_typer(feature_app, name="feature")
app.add_typer(step_app, name="step")
app.add_typer(service_app, name="service")
app.add_typer(artifact_app, name="artifact")


def _db():
    from mc.db import get_db, init_db
    conn = get_db()
    init_db(conn)
    return conn


def _print(data):
    typer.echo(json.dumps(data, indent=2, default=str))
```

- [ ] **Step 5: Install dependencies and verify CLI starts**

Run:
```bash
cd /Users/evgesha/Documents/Projects/mission-control && poetry install
mc --help
```
Expected: typer help output showing `pipeline`, `feature`, `step`, `service`, `artifact` subcommands.

- [ ] **Step 6: Commit**

```
feat(cli): scaffold Python CLI project with typer and SQLite schema
```

---

### Task 2: Pipeline Commands

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `mc/pipelines.py`
- Create: `tests/conftest.py`
- Create: `tests/test_pipelines.py`
- Modify: `mc/cli.py`

- [ ] **Step 1: Create `tests/conftest.py` with shared fixtures**

```python
import pytest
import sqlite3
from mc.db import init_db


@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    yield conn
    conn.close()


SAMPLE_YAML = """
name: Software Development
stages:
  - name: Plan
    exit_conditions:
      required_artifacts: [implementation-plan, plan-review-report]
      human_approval: true
    steps:
      - name: Write Plans
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: writing-plans
        parallel: true
      - name: Plan Review
        agent: code-reviewer
        skill: plan-review
        loop_back_to: Write Plans
  - name: Implement
    exit_conditions:
      required_artifacts: [implementation-commit, review-report]
      human_approval: true
    steps:
      - name: Code
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: executing-plans
        parallel: true
      - name: Code Review
        agent: code-reviewer
        skill: requesting-code-review
        loop_back_to: Code
""".strip()
```

- [ ] **Step 2: Write failing tests for pipeline create and get**

Create `tests/test_pipelines.py`:

```python
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline, get_pipeline


def test_create_pipeline(db):
    result = create_pipeline(db, SAMPLE_YAML)
    assert result["name"] == "Software Development"
    assert "id" in result


def test_create_pipeline_stores_yaml(db):
    result = create_pipeline(db, SAMPLE_YAML)
    row = db.execute("SELECT config FROM pipelines WHERE id = ?", (result["id"],)).fetchone()
    assert row["config"] == SAMPLE_YAML


def test_create_pipeline_parses_stages(db):
    result = create_pipeline(db, SAMPLE_YAML)
    assert len(result["stages"]) == 2
    assert result["stages"][0]["name"] == "Plan"
    assert result["stages"][1]["name"] == "Implement"


def test_create_pipeline_parses_steps(db):
    result = create_pipeline(db, SAMPLE_YAML)
    plan_stage = result["stages"][0]
    assert len(plan_stage["steps"]) == 2
    assert plan_stage["steps"][0]["name"] == "Write Plans"
    assert plan_stage["steps"][1]["name"] == "Plan Review"


def test_get_pipeline(db):
    created = create_pipeline(db, SAMPLE_YAML)
    fetched = get_pipeline(db, created["id"])
    assert fetched["id"] == created["id"]
    assert fetched["name"] == "Software Development"


def test_get_pipeline_not_found(db):
    result = get_pipeline(db, "nonexistent")
    assert result is None


def test_create_duplicate_name_fails(db):
    create_pipeline(db, SAMPLE_YAML)
    import pytest
    with pytest.raises(Exception):
        create_pipeline(db, SAMPLE_YAML)


def test_invalid_yaml_fails(db):
    import pytest
    with pytest.raises(ValueError):
        create_pipeline(db, "not: valid: pipeline:")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_pipelines.py -v`
Expected: FAIL — `mc.pipelines` module does not exist.

- [ ] **Step 4: Implement `mc/pipelines.py`**

Port of `repos/server/src/pipelines.ts`. Simplified: no `document_paths` loading, no `executor`/`config` parsing. Stores YAML as-is, parses stages/steps for the return value.

```python
"""Pipeline CRUD operations."""

import yaml

from mc.db import STAGE_SENTINEL, _id, _now


def _parse_stages(config: dict) -> list[dict]:
    stages = config.get("stages", [])
    result = []
    for stage in stages:
        parsed = {
            "name": stage["name"],
            "exit_conditions": stage.get("exit_conditions", {}),
            "steps": [],
        }
        for step in stage.get("steps", []):
            parsed["steps"].append({
                "name": step["name"],
                "agent": step.get("agent"),
                "skill": step.get("skill"),
                "parallel": step.get("parallel", False),
                "loop_back_to": step.get("loop_back_to"),
            })
        result.append(parsed)
    return result


def create_pipeline(conn, yaml_config: str) -> dict:
    config = yaml.safe_load(yaml_config)
    if not config or "stages" not in config:
        raise ValueError("Pipeline YAML must have 'stages'")
    name = config.get("name", "Unnamed")

    pipeline_id = _id()
    now = _now()
    stages = _parse_stages(config)

    conn.execute(
        "INSERT INTO pipelines (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (pipeline_id, name, yaml_config, now, now),
    )
    conn.commit()

    return {"id": pipeline_id, "name": name, "stages": stages, "created_at": now, "updated_at": now}


def get_pipeline(conn, pipeline_id: str) -> dict | None:
    row = conn.execute(
        "SELECT id, name, config, created_at, updated_at FROM pipelines WHERE id = ?",
        (pipeline_id,),
    ).fetchone()

    if not row:
        return None

    config = yaml.safe_load(row["config"])
    stages = _parse_stages(config)

    return {
        "id": row["id"],
        "name": row["name"],
        "stages": stages,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_pipelines.py -v`
Expected: all PASS.

- [ ] **Step 6: Wire CLI commands**

Add to `mc/cli.py`:

```python
from pathlib import Path

@pipeline_app.command("create")
def pipeline_create(file: str = typer.Option(..., "--file")):
    conn = _db()
    yaml_content = Path(file).read_text()
    from mc.pipelines import create_pipeline
    result = create_pipeline(conn, yaml_content)
    conn.close()
    _print(result)
```

- [ ] **Step 7: Manual CLI test**

Run:
```bash
cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator
mc pipeline create --file pipelines/software-dev.yaml
```
Expected: JSON output with pipeline id, name, stages. (Note: this uses the existing YAML which has the old schema — that's fine for verifying the CLI works. The YAML will be updated in Chunk 3.)

- [ ] **Step 8: Commit**

```
feat(cli): add pipeline create/get with YAML parsing
```

---

### Task 3: Feature Commands

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `mc/features.py`
- Create: `tests/test_features.py`
- Modify: `mc/cli.py`

- [ ] **Step 1: Write failing tests for feature create and get**

Create `tests/test_features.py`:

```python
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline
from mc.features import create_feature, get_feature


def test_create_feature(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test Feature", pipeline_id=pipeline["id"])
    assert feature["title"] == "Test Feature"
    assert feature["current_stage"] == "Plan"
    assert feature["status"] == "active"


def test_create_feature_initializes_progress(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    # Should have stage_progress rows for: Plan(__stage__), Plan/Write Plans, Plan/Plan Review,
    # Implement(__stage__), Implement/Code, Implement/Code Review = 6 rows
    rows = db.execute(
        "SELECT stage, step, status FROM stage_progress WHERE feature_id = ? ORDER BY rowid",
        (feature["id"],),
    ).fetchall()
    assert len(rows) == 6
    stages_steps = [(r["stage"], r["step"]) for r in rows]
    assert ("Plan", "__stage__") in stages_steps
    assert ("Plan", "Write Plans") in stages_steps
    assert ("Plan", "Plan Review") in stages_steps
    assert ("Implement", "__stage__") in stages_steps
    assert ("Implement", "Code") in stages_steps
    assert ("Implement", "Code Review") in stages_steps
    assert all(r["status"] == "pending" for r in rows)


def test_get_feature_returns_full_state(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    fetched = get_feature(db, feature["id"])
    assert fetched["id"] == feature["id"]
    assert "stages" in fetched  # nested stage progress
    assert "services" in fetched
    assert "artifacts" in fetched


def test_get_feature_not_found(db):
    result = get_feature(db, "nonexistent")
    assert result is None


def test_create_feature_invalid_pipeline(db):
    import pytest
    with pytest.raises(ValueError):
        create_feature(db, title="Test", pipeline_id="nonexistent")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_features.py -v`
Expected: FAIL — `mc.features` does not exist.

- [ ] **Step 3: Implement `mc/features.py`**

Port of `repos/server/src/features.ts`. Creates feature at first YAML stage, initializes all `stage_progress` rows. `get_feature` returns nested progress + services + artifacts.

```python
"""Feature lifecycle operations."""

import yaml

from mc.db import STAGE_SENTINEL, _id, _now


def create_feature(conn, title: str, pipeline_id: str, description: str | None = None) -> dict:
    row = conn.execute("SELECT config FROM pipelines WHERE id = ?", (pipeline_id,)).fetchone()
    if not row:
        raise ValueError(f"Pipeline not found: {pipeline_id}")

    config = yaml.safe_load(row["config"])
    stages = config["stages"]
    first_stage = stages[0]["name"]

    feature_id = _id()
    now = _now()

    conn.execute(
        "INSERT INTO features (id, title, description, pipeline_id, current_stage, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
        (feature_id, title, description, pipeline_id, first_stage, now, now),
    )

    for stage in stages:
        conn.execute(
            "INSERT INTO stage_progress (id, feature_id, stage, step, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
            (_id(), feature_id, stage["name"], STAGE_SENTINEL, now),
        )
        for step in stage.get("steps", []):
            conn.execute(
                "INSERT INTO stage_progress (id, feature_id, stage, step, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                (_id(), feature_id, stage["name"], step["name"], now),
            )

    conn.commit()
    return get_feature(conn, feature_id)


def get_feature(conn, feature_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM features WHERE id = ?", (feature_id,)).fetchone()
    if not row:
        return None

    # Build nested stage progress
    progress_rows = conn.execute(
        "SELECT stage, step, status, started_at, completed_at FROM stage_progress "
        "WHERE feature_id = ? ORDER BY rowid",
        (feature_id,),
    ).fetchall()

    artifacts = conn.execute(
        "SELECT stage, step, type, content, created_at FROM artifacts "
        "WHERE feature_id = ? ORDER BY created_at DESC",
        (feature_id,),
    ).fetchall()

    services = conn.execute(
        "SELECT service_name, status FROM feature_services WHERE feature_id = ?",
        (feature_id,),
    ).fetchall()

    # Group progress by stage
    stages = []
    current_stage = None
    for pr in progress_rows:
        if pr["step"] == STAGE_SENTINEL:
            current_stage = {
                "stage": pr["stage"],
                "status": pr["status"],
                "started_at": pr["started_at"],
                "completed_at": pr["completed_at"],
                "steps": [],
                "artifacts": [
                    {"type": a["type"], "content": a["content"], "created_at": a["created_at"]}
                    for a in artifacts
                    if a["stage"] == pr["stage"] and a["step"] == STAGE_SENTINEL
                ],
            }
            stages.append(current_stage)
        elif current_stage and current_stage["stage"] == pr["stage"]:
            current_stage["steps"].append({
                "step": pr["step"],
                "status": pr["status"],
                "started_at": pr["started_at"],
                "completed_at": pr["completed_at"],
                "artifacts": [
                    {"type": a["type"], "content": a["content"], "created_at": a["created_at"]}
                    for a in artifacts
                    if a["stage"] == pr["stage"] and a["step"] == pr["step"]
                ],
            })

    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "pipeline_id": row["pipeline_id"],
        "current_stage": row["current_stage"],
        "status": row["status"],
        "stages": stages,
        "services": [{"name": s["service_name"], "status": s["status"]} for s in services],
        "artifacts": [dict(a) for a in artifacts],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def advance_feature(conn, feature_id: str, approved: bool = False) -> dict:
    feature = get_feature(conn, feature_id)
    if not feature:
        raise ValueError(f"Feature not found: {feature_id}")
    if feature["status"] != "active":
        raise ValueError(f"Feature is not active: {feature['status']}")

    pipeline_row = conn.execute("SELECT config FROM pipelines WHERE id = ?", (feature["pipeline_id"],)).fetchone()
    config = yaml.safe_load(pipeline_row["config"])
    stages = config["stages"]

    current_idx = next(i for i, s in enumerate(stages) if s["name"] == feature["current_stage"])
    current_stage = stages[current_idx]
    exit_cond = current_stage.get("exit_conditions", {})

    # Check required artifacts
    required = exit_cond.get("required_artifacts", [])
    if required:
        existing = conn.execute(
            "SELECT DISTINCT type FROM artifacts WHERE feature_id = ? AND stage = ?",
            (feature_id, feature["current_stage"]),
        ).fetchall()
        existing_types = {r["type"] for r in existing}
        missing = [t for t in required if t not in existing_types]
        if missing:
            raise ValueError(f"Missing required artifacts: {missing}")

    # Check all children complete
    child_rows = conn.execute(
        "SELECT step, status FROM stage_progress WHERE feature_id = ? AND stage = ? AND step != ?",
        (feature_id, feature["current_stage"], STAGE_SENTINEL),
    ).fetchall()
    incomplete = [r["step"] for r in child_rows if r["status"] not in ("completed", "skipped")]
    if incomplete:
        raise ValueError(f"Incomplete steps: {incomplete}")

    # Check human approval
    if exit_cond.get("human_approval", False) and not approved:
        raise ValueError("Human approval required: pass --approved")

    now = _now()

    # Mark current stage as completed
    conn.execute(
        "UPDATE stage_progress SET status = 'completed', completed_at = ? "
        "WHERE feature_id = ? AND stage = ? AND step = ?",
        (now, feature_id, feature["current_stage"], STAGE_SENTINEL),
    )

    if current_idx == len(stages) - 1:
        # Last stage — complete the feature
        conn.execute(
            "UPDATE features SET status = 'completed', updated_at = ? WHERE id = ?",
            (now, feature_id),
        )
    else:
        # Move to next stage
        next_stage = stages[current_idx + 1]["name"]
        conn.execute(
            "UPDATE features SET current_stage = ?, updated_at = ? WHERE id = ?",
            (next_stage, now, feature_id),
        )

    conn.commit()
    return get_feature(conn, feature_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_features.py -v`
Expected: all PASS.

- [ ] **Step 5: Wire CLI commands**

Add to `mc/cli.py`:

```python
@feature_app.command("create")
def feature_create(
    title: str = typer.Option(..., "--title"),
    pipeline: str = typer.Option(..., "--pipeline"),
    description: str = typer.Option(None, "--description"),
):
    conn = _db()
    from mc.features import create_feature
    result = create_feature(conn, title=title, pipeline_id=pipeline, description=description)
    conn.close()
    _print(result)


@feature_app.command("get")
def feature_get(id: str = typer.Argument(...)):
    conn = _db()
    from mc.features import get_feature
    result = get_feature(conn, id)
    conn.close()
    if result is None:
        typer.echo(json.dumps({"error": f"Feature not found: {id}"}), err=True)
        raise typer.Exit(1)
    _print(result)


@feature_app.command("advance")
def feature_advance(
    id: str = typer.Argument(...),
    approved: bool = typer.Option(False, "--approved"),
):
    conn = _db()
    from mc.features import advance_feature
    try:
        result = advance_feature(conn, id, approved=approved)
        conn.close()
        _print(result)
    except ValueError as e:
        conn.close()
        typer.echo(json.dumps({"error": str(e)}), err=True)
        raise typer.Exit(1)
```

- [ ] **Step 6: Commit**

```
feat(cli): add feature create/get/advance with exit condition validation
```

---

## Chunk 2: MC CLI — Tracking & Artifact Commands

### Task 4: Service Commands

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `mc/services.py`
- Create: `tests/test_services.py`
- Modify: `mc/cli.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_services.py`:

```python
import pytest
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline
from mc.features import create_feature
from mc.services import register_service, link_feature_service, update_service_status


def test_register_service(db):
    result = register_service(db, name="frontend", path="./frontend", stack="sveltekit")
    assert result["name"] == "frontend"
    assert result["path"] == "./frontend"
    assert result["stack"] == "sveltekit"


def test_register_duplicate_fails(db):
    register_service(db, name="frontend", path="./frontend", stack="sveltekit")
    with pytest.raises(Exception):
        register_service(db, name="frontend", path="./frontend", stack="sveltekit")


def test_link_feature_service(db):
    register_service(db, name="frontend", path="./frontend", stack="sveltekit")
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    link_feature_service(db, feature["id"], "frontend")
    row = db.execute(
        "SELECT status FROM feature_services WHERE feature_id = ? AND service_name = ?",
        (feature["id"], "frontend"),
    ).fetchone()
    assert row["status"] == "pending"


def test_update_service_status(db):
    register_service(db, name="frontend", path="./frontend", stack="sveltekit")
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    link_feature_service(db, feature["id"], "frontend")
    update_service_status(db, feature["id"], "frontend", "completed")
    row = db.execute(
        "SELECT status FROM feature_services WHERE feature_id = ? AND service_name = ?",
        (feature["id"], "frontend"),
    ).fetchone()
    assert row["status"] == "completed"


def test_update_service_status_not_found(db):
    with pytest.raises(ValueError):
        update_service_status(db, "fake", "fake", "completed")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_services.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `mc/services.py`**

```python
"""Service registry and feature-service linking."""

from mc.db import _id, _now


def register_service(conn, name: str, path: str, stack: str) -> dict:
    now = _now()
    conn.execute(
        "INSERT INTO services (name, path, stack, created_at) VALUES (?, ?, ?, ?)",
        (name, path, stack, now),
    )
    conn.commit()
    return {"name": name, "path": path, "stack": stack, "created_at": now}


def link_feature_service(conn, feature_id: str, service_name: str) -> dict:
    conn.execute(
        "INSERT INTO feature_services (feature_id, service_name, status) VALUES (?, ?, 'pending')",
        (feature_id, service_name),
    )
    conn.commit()
    return {"feature_id": feature_id, "service_name": service_name, "status": "pending"}


def update_service_status(conn, feature_id: str, service_name: str, status: str) -> dict:
    cursor = conn.execute(
        "UPDATE feature_services SET status = ? WHERE feature_id = ? AND service_name = ?",
        (status, feature_id, service_name),
    )
    if cursor.rowcount == 0:
        raise ValueError(f"Service link not found: feature={feature_id} service={service_name}")
    conn.commit()
    return {"feature_id": feature_id, "service_name": service_name, "status": status}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_services.py -v`
Expected: all PASS.

- [ ] **Step 5: Wire CLI commands**

Add to `mc/cli.py`:

```python
@service_app.command("register")
def service_register(
    name: str = typer.Argument(...),
    path: str = typer.Option(..., "--path"),
    stack: str = typer.Option(..., "--stack"),
):
    conn = _db()
    from mc.services import register_service
    result = register_service(conn, name=name, path=path, stack=stack)
    conn.close()
    _print(result)


@service_app.command("link")
def service_link(
    feature_id: str = typer.Argument(...),
    service_name: str = typer.Argument(...),
):
    conn = _db()
    from mc.services import link_feature_service
    result = link_feature_service(conn, feature_id, service_name)
    conn.close()
    _print(result)


@service_app.command("status")
def service_status(
    feature_id: str = typer.Argument(...),
    service_name: str = typer.Argument(...),
    status: str = typer.Option(..., "--status"),
):
    conn = _db()
    from mc.services import update_service_status
    try:
        result = update_service_status(conn, feature_id, service_name, status)
        conn.close()
        _print(result)
    except ValueError as e:
        conn.close()
        typer.echo(json.dumps({"error": str(e)}), err=True)
        raise typer.Exit(1)
```

- [ ] **Step 6: Commit**

```
feat(cli): add service register/link/status commands
```

---

### Task 5: Step Update Command

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `mc/progress.py`
- Create: `tests/test_progress.py`
- Modify: `mc/cli.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_progress.py`:

```python
import pytest
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline
from mc.features import create_feature
from mc.progress import update_step_status


def test_update_stage_level(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", None, "in_progress")
    row = db.execute(
        "SELECT status, started_at FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = '__stage__'",
        (feature["id"], "Plan"),
    ).fetchone()
    assert row["status"] == "in_progress"
    assert row["started_at"] is not None


def test_update_step_level(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "in_progress")
    row = db.execute(
        "SELECT status FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?",
        (feature["id"], "Plan", "Write Plans"),
    ).fetchone()
    assert row["status"] == "in_progress"


def test_update_completed_sets_timestamp(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "in_progress")
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    row = db.execute(
        "SELECT completed_at FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?",
        (feature["id"], "Plan", "Write Plans"),
    ).fetchone()
    assert row["completed_at"] is not None


def test_update_in_progress_resets_completed(db):
    """Loop-back: setting in_progress clears completed_at and resets started_at."""
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "in_progress")
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Write Plans", "in_progress")
    row = db.execute(
        "SELECT started_at, completed_at FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?",
        (feature["id"], "Plan", "Write Plans"),
    ).fetchone()
    assert row["started_at"] is not None
    assert row["completed_at"] is None


def test_update_invalid_status_fails(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    with pytest.raises(ValueError, match="Invalid status"):
        update_step_status(db, feature["id"], "Plan", None, "banana")


def test_update_nonexistent_fails(db):
    with pytest.raises(ValueError):
        update_step_status(db, "fake", "Fake", None, "in_progress")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_progress.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `mc/progress.py`**

Port of `repos/server/src/progress.ts`. Key behavior: `in_progress` sets `started_at` and clears `completed_at` (supports loop-back). `completed`/`skipped` sets `completed_at`.

```python
"""Step/stage progress tracking."""

from mc.db import STAGE_SENTINEL, _now

VALID_STATUSES = {"pending", "in_progress", "completed", "failed", "skipped"}


def update_step_status(conn, feature_id: str, stage: str, step: str | None, status: str) -> dict:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Must be one of: {VALID_STATUSES}")

    step_value = step or STAGE_SENTINEL
    now = _now()

    existing = conn.execute(
        "SELECT id FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?",
        (feature_id, stage, step_value),
    ).fetchone()

    if not existing:
        raise ValueError(f"No progress row: feature={feature_id} stage={stage} step={step_value}")

    if status == "in_progress":
        conn.execute(
            "UPDATE stage_progress SET status = ?, started_at = ?, completed_at = NULL "
            "WHERE feature_id = ? AND stage = ? AND step = ?",
            (status, now, feature_id, stage, step_value),
        )
    elif status in ("completed", "skipped"):
        conn.execute(
            "UPDATE stage_progress SET status = ?, completed_at = ? "
            "WHERE feature_id = ? AND stage = ? AND step = ?",
            (status, now, feature_id, stage, step_value),
        )
    elif status == "failed":
        conn.execute(
            "UPDATE stage_progress SET status = ? WHERE feature_id = ? AND stage = ? AND step = ?",
            (status, feature_id, stage, step_value),
        )
    else:
        conn.execute(
            "UPDATE stage_progress SET status = ? WHERE feature_id = ? AND stage = ? AND step = ?",
            (status, feature_id, stage, step_value),
        )

    conn.commit()
    return {"feature_id": feature_id, "stage": stage, "step": step_value, "status": status}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_progress.py -v`
Expected: all PASS.

- [ ] **Step 5: Wire CLI command**

Add to `mc/cli.py`:

```python
@step_app.command("update")
def step_update(
    feature_id: str = typer.Argument(...),
    stage: str = typer.Argument(...),
    step: str = typer.Argument(None),
    status: str = typer.Option(..., "--status"),
):
    conn = _db()
    from mc.progress import update_step_status
    try:
        result = update_step_status(conn, feature_id, stage, step, status)
        conn.close()
        _print(result)
    except ValueError as e:
        conn.close()
        typer.echo(json.dumps({"error": str(e)}), err=True)
        raise typer.Exit(1)
```

- [ ] **Step 6: Commit**

```
feat(cli): add step update command with loop-back support
```

---

### Task 6: Artifact Commands

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `mc/artifacts.py`
- Create: `tests/test_artifacts.py`
- Modify: `mc/cli.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_artifacts.py`:

```python
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline
from mc.features import create_feature
from mc.artifacts import add_artifact, get_artifacts


def test_add_artifact_stage_level(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    result = add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "path/to/plan.md")
    assert result["type"] == "implementation-plan"
    assert result["content"] == "path/to/plan.md"
    assert result["step"] == "__stage__"


def test_add_artifact_step_level(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    result = add_artifact(db, feature["id"], "Plan", "Write Plans", "implementation-plan", "path/to/plan.md")
    assert result["step"] == "Write Plans"


def test_get_artifacts_all(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    add_artifact(db, feature["id"], "Plan", "Write Plans", "implementation-plan", "plan1.md")
    add_artifact(db, feature["id"], "Plan", "Write Plans", "implementation-plan", "plan2.md")
    results = get_artifacts(db, feature["id"])
    assert len(results) == 2


def test_get_artifacts_filtered_by_stage(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    add_artifact(db, feature["id"], "Implement", None, "implementation-commit", "abc123")
    results = get_artifacts(db, feature["id"], stage="Plan")
    assert len(results) == 1
    assert results[0]["type"] == "implementation-plan"


def test_get_artifacts_ordered_by_created_at_desc(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    add_artifact(db, feature["id"], "Plan", None, "first", "a")
    add_artifact(db, feature["id"], "Plan", None, "second", "b")
    results = get_artifacts(db, feature["id"])
    assert results[0]["type"] == "second"
    assert results[1]["type"] == "first"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_artifacts.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `mc/artifacts.py`**

```python
"""Artifact storage and retrieval."""

from mc.db import STAGE_SENTINEL, _id, _now


def add_artifact(conn, feature_id: str, stage: str, step: str | None, artifact_type: str, content: str) -> dict:
    artifact_id = _id()
    step_value = step or STAGE_SENTINEL
    now = _now()

    conn.execute(
        "INSERT INTO artifacts (id, feature_id, stage, step, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (artifact_id, feature_id, stage, step_value, artifact_type, content, now),
    )
    conn.commit()

    return {
        "id": artifact_id,
        "feature_id": feature_id,
        "stage": stage,
        "step": step_value,
        "type": artifact_type,
        "content": content,
        "created_at": now,
    }


def get_artifacts(conn, feature_id: str, stage: str | None = None, step: str | None = None) -> list[dict]:
    query = "SELECT * FROM artifacts WHERE feature_id = ?"
    params: list[str] = [feature_id]

    if stage:
        query += " AND stage = ?"
        params.append(stage)
    if step:
        query += " AND step = ?"
        params.append(step)

    query += " ORDER BY created_at DESC, rowid DESC"

    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_artifacts.py -v`
Expected: all PASS.

- [ ] **Step 5: Wire CLI commands**

Add to `mc/cli.py`:

```python
@artifact_app.command("add")
def artifact_add(
    feature_id: str = typer.Argument(...),
    stage: str = typer.Argument(...),
    step: str = typer.Option(None, "--step"),
    type: str = typer.Option(..., "--type"),
    content: str = typer.Option(..., "--content"),
):
    conn = _db()
    from mc.artifacts import add_artifact
    result = add_artifact(conn, feature_id, stage, step, type, content)
    conn.close()
    _print(result)


@artifact_app.command("get")
def artifact_get(
    feature_id: str = typer.Argument(...),
    stage: str = typer.Option(None, "--stage"),
    step: str = typer.Option(None, "--step"),
):
    conn = _db()
    from mc.artifacts import get_artifacts
    results = get_artifacts(conn, feature_id, stage=stage, step=step)
    conn.close()
    _print(results)
```

- [ ] **Step 6: Commit**

```
feat(cli): add artifact add/get commands with DESC ordering
```

---

### Task 7: Feature Advance — Integration Tests

**Repo:** `/Users/evgesha/Documents/Projects/mission-control/`

**Files:**
- Create: `tests/test_advance.py`

- [ ] **Step 1: Write integration tests for the full advance flow**

```python
import pytest
from tests.conftest import SAMPLE_YAML
from mc.pipelines import create_pipeline
from mc.features import create_feature, advance_feature
from mc.progress import update_step_status
from mc.artifacts import add_artifact


def test_advance_checks_required_artifacts(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    # Complete all steps but don't add artifacts
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Plan Review", "completed")
    with pytest.raises(ValueError, match="Missing required artifacts"):
        advance_feature(db, feature["id"], approved=True)


def test_advance_checks_children_complete(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    # Add required artifacts but don't complete steps
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    add_artifact(db, feature["id"], "Plan", None, "plan-review-report", "review.md")
    with pytest.raises(ValueError, match="Incomplete steps"):
        advance_feature(db, feature["id"], approved=True)


def test_advance_checks_all_required_artifacts(db):
    """Plan stage requires both implementation-plan AND plan-review-report."""
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Plan Review", "completed")
    # Only add one of the two required artifacts
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    with pytest.raises(ValueError, match="Missing required artifacts"):
        advance_feature(db, feature["id"], approved=True)


def test_advance_checks_human_approval(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Plan Review", "completed")
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    add_artifact(db, feature["id"], "Plan", None, "plan-review-report", "review.md")
    with pytest.raises(ValueError, match="Human approval required"):
        advance_feature(db, feature["id"], approved=False)


def test_advance_moves_to_next_stage(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Plan Review", "completed")
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    add_artifact(db, feature["id"], "Plan", None, "plan-review-report", "review.md")
    result = advance_feature(db, feature["id"], approved=True)
    assert result["current_stage"] == "Implement"
    assert result["status"] == "active"


def test_advance_completes_feature_at_last_stage(db):
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    # Advance past Plan
    update_step_status(db, feature["id"], "Plan", "Write Plans", "completed")
    update_step_status(db, feature["id"], "Plan", "Plan Review", "completed")
    add_artifact(db, feature["id"], "Plan", None, "implementation-plan", "plan.md")
    add_artifact(db, feature["id"], "Plan", None, "plan-review-report", "review.md")
    advance_feature(db, feature["id"], approved=True)
    # Now at Implement — advance past it
    update_step_status(db, feature["id"], "Implement", "Code", "completed")
    update_step_status(db, feature["id"], "Implement", "Code Review", "completed")
    add_artifact(db, feature["id"], "Implement", None, "implementation-commit", "abc123")
    add_artifact(db, feature["id"], "Implement", None, "review-report", "review.md")
    result = advance_feature(db, feature["id"], approved=True)
    assert result["status"] == "completed"


def test_loop_back_then_advance(db):
    """Simulate Plan Review failure, loop back to Write Plans, re-complete, then advance."""
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Test", pipeline_id=pipeline["id"])
    fid = feature["id"]

    # First attempt: complete Write Plans
    update_step_status(db, fid, "Plan", "Write Plans", "in_progress")
    update_step_status(db, fid, "Plan", "Write Plans", "completed")
    add_artifact(db, fid, "Plan", "Write Plans", "implementation-plan", "plan-v1.md")

    # Plan Review fails — loop back
    update_step_status(db, fid, "Plan", "Plan Review", "in_progress")
    # Simulate failure: reset Write Plans
    update_step_status(db, fid, "Plan", "Write Plans", "in_progress")

    # Verify Write Plans was properly reset
    row = db.execute(
        "SELECT status, completed_at FROM stage_progress WHERE feature_id = ? AND stage = ? AND step = ?",
        (fid, "Plan", "Write Plans"),
    ).fetchone()
    assert row["status"] == "in_progress"
    assert row["completed_at"] is None

    # Second attempt: re-complete Write Plans
    update_step_status(db, fid, "Plan", "Write Plans", "completed")
    add_artifact(db, fid, "Plan", "Write Plans", "implementation-plan", "plan-v2.md")

    # Plan Review passes
    update_step_status(db, fid, "Plan", "Plan Review", "completed")
    add_artifact(db, fid, "Plan", "Plan Review", "plan-review-report", "review.md")

    # Advance should work — all steps completed, all artifacts present
    result = advance_feature(db, fid, approved=True)
    assert result["current_stage"] == "Implement"


def test_full_pipeline_flow(db):
    """End-to-end: create pipeline, create feature, track progress, advance through all stages."""
    pipeline = create_pipeline(db, SAMPLE_YAML)
    feature = create_feature(db, title="Param Inference", pipeline_id=pipeline["id"])
    fid = feature["id"]

    # Plan stage
    update_step_status(db, fid, "Plan", None, "in_progress")
    update_step_status(db, fid, "Plan", "Write Plans", "in_progress")
    update_step_status(db, fid, "Plan", "Write Plans", "completed")
    add_artifact(db, fid, "Plan", "Write Plans", "implementation-plan", "frontend/docs/plans/param-inference.md")
    add_artifact(db, fid, "Plan", "Write Plans", "implementation-plan", "backend/docs/plans/param-inference.md")
    update_step_status(db, fid, "Plan", "Plan Review", "in_progress")
    update_step_status(db, fid, "Plan", "Plan Review", "completed")
    add_artifact(db, fid, "Plan", "Plan Review", "plan-review-report", "plan-review.md")
    update_step_status(db, fid, "Plan", None, "completed")
    result = advance_feature(db, fid, approved=True)
    assert result["current_stage"] == "Implement"

    # Implement stage
    update_step_status(db, fid, "Implement", None, "in_progress")
    update_step_status(db, fid, "Implement", "Code", "in_progress")
    update_step_status(db, fid, "Implement", "Code", "completed")
    add_artifact(db, fid, "Implement", "Code", "implementation-commit", "fe-sha-abc")
    add_artifact(db, fid, "Implement", "Code", "implementation-commit", "be-sha-def")
    update_step_status(db, fid, "Implement", "Code Review", "in_progress")
    update_step_status(db, fid, "Implement", "Code Review", "completed")
    add_artifact(db, fid, "Implement", "Code Review", "review-report", "code-review.md")
    update_step_status(db, fid, "Implement", None, "completed")
    result = advance_feature(db, fid, approved=True)
    assert result["status"] == "completed"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest tests/test_advance.py -v`
Expected: all PASS (the implementation was done in Task 3).

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/evgesha/Documents/Projects/mission-control && poetry run pytest -v`
Expected: all tests across all files PASS.

- [ ] **Step 4: Commit**

```
test(cli): add advance integration tests and full pipeline flow test
```

---

## Chunk 3: Orchestrator — YAML, Agents, Dispatcher

### Task 8: Pipeline YAML

**Repo:** `/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/`

**Files:**
- Modify: `pipelines/software-dev.yaml`

- [ ] **Step 1: Replace pipeline YAML with the new schema**

Overwrite `pipelines/software-dev.yaml` with the design spec's YAML:

```yaml
name: Software Development

stages:
  - name: Plan
    exit_conditions:
      required_artifacts: [implementation-plan, plan-review-report]
      human_approval: true
    steps:
      - name: Write Plans
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: writing-plans
        parallel: true

      - name: Plan Review
        agent: code-reviewer
        skill: plan-review
        loop_back_to: Write Plans

  - name: Implement
    exit_conditions:
      required_artifacts: [implementation-commit, review-report]
      human_approval: true
    steps:
      - name: Code
        agent:
          frontend: svelte-architect
          backend: senior-code-architect-PY
        skill: executing-plans
        parallel: true

      - name: Code Review
        agent: code-reviewer
        skill: requesting-code-review
        loop_back_to: Code
```

- [ ] **Step 2: Verify it loads through MC CLI**

Run:
```bash
cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator
mc pipeline create --file pipelines/software-dev.yaml
```
Expected: JSON with 2 stages, 4 steps total.

- [ ] **Step 3: Commit**

```
refactor(pipeline): replace YAML with stage-agent schema
```

---

### Task 9: Agent Definitions

**Repo:** `/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/`

**Files:**
- Create: `.claude/agents/svelte-architect.md`
- Create: `.claude/agents/senior-code-architect-PY.md`
- Create: `.claude/agents/code-reviewer.md`

- [ ] **Step 1: Create `.claude/agents/` directory**

Run: `mkdir -p /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/.claude/agents`

- [ ] **Step 2: Create `svelte-architect.md`**

```markdown
# svelte-architect

## Identity
Frontend implementation agent for SvelteKit applications.

## Constraints
- Working directory: `frontend/` only
- Use only `fe--*` skills
- Do not modify backend code
- Do not reference backend repo internals
- Read `frontend/CLAUDE.md` for project conventions

## Output Contract
- Plan writing: output the file path to the plan
- Implementation: output the commit SHA
```

- [ ] **Step 3: Create `senior-code-architect-PY.md`**

```markdown
# senior-code-architect-PY

## Identity
Backend implementation agent for Python/FastAPI applications.

## Constraints
- Working directory: `backend/` only
- Use only `be--*` skills
- Do not modify frontend code
- Do not reference frontend repo internals
- Read `backend/CLAUDE.md` for project conventions

## Output Contract
- Plan writing: output the file path to the plan
- Implementation: output the commit SHA
```

- [ ] **Step 4: Create `code-reviewer.md`**

```markdown
# code-reviewer

## Identity
Cross-repo consistency reviewer. Verifies plans and implementations against specs.

## Constraints
- Do NOT modify any code or files
- Report only — structured pass/fail per contract point
- Has read access to both `frontend/` and `backend/` via symlinks

## Output Contract
For each contract point in the spec:
- PASS or FAIL with specific mismatch details
- Final verdict: PASS (all checks passed) or FAIL (any check failed)
```

- [ ] **Step 5: Commit**

```
feat(agents): add svelte-architect, senior-code-architect-PY, code-reviewer definitions
```

---

### Task 10: Dispatcher Skill

**Repo:** `/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/`

**Files:**
- Modify: `.claude/skills/dispatch-pipeline/SKILL.md`

- [ ] **Step 1: Rewrite the dispatcher skill**

Replace contents of `.claude/skills/dispatch-pipeline/SKILL.md`:

```markdown
---
name: dispatch-pipeline
description: Use when starting work on a feature — creates it in Mission Control, registers services, and orchestrates the plan→verify→implement→verify flow
---

# Dispatch Pipeline

## When to Use

When starting work on a feature that should flow through the delivery pipeline.

## Prerequisites

One-time setup (skip if already done — check with `mc pipeline create --file pipelines/software-dev.yaml`):

```bash
mc service register frontend --path ./frontend --stack sveltekit
mc service register backend --path ./backend --stack fastapi
mc pipeline create --file pipelines/software-dev.yaml
```

## Process

### 1. Create Feature

```bash
mc feature create --title "{feature_title}" --pipeline {pipeline_id}
mc service link {feature_id} frontend
mc service link {feature_id} backend
mc feature get {feature_id}
```

### 2. Plan Stage

```bash
mc step update {feature_id} Plan --status in_progress
```

**Step: Write Plans**

```bash
mc step update {feature_id} Plan "Write Plans" --status in_progress
```

Dispatch two scoped agents sequentially (or in parallel if using Agent tool with multiple calls):

**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Prompt: Plan Writing template (see design spec) with `{feature_spec_content}` injected
- Output: `frontend/docs/plans/{feature_slug}.md`

**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Prompt: Plan Writing template with `{feature_spec_content}` injected
- Output: `backend/docs/plans/{feature_slug}.md`

After both complete:

```bash
mc service status {feature_id} frontend --status completed
mc service status {feature_id} backend --status completed
mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content frontend/docs/plans/{feature_slug}.md
mc artifact add {feature_id} Plan --step "Write Plans" --type implementation-plan --content backend/docs/plans/{feature_slug}.md
mc step update {feature_id} Plan "Write Plans" --status completed
```

**Step: Plan Review**

```bash
mc step update {feature_id} Plan "Plan Review" --status in_progress
```

Dispatch `code-reviewer` agent (global scope — sees both repos):
- Prompt: Global Verifier template with both plans + original spec
- Output: PASS/FAIL per contract point

**If FAIL:**
```bash
mc step update {feature_id} Plan "Write Plans" --status in_progress
mc service status {feature_id} frontend --status in_progress
mc service status {feature_id} backend --status in_progress
```
Re-dispatch Write Plans agents with review feedback appended. Loop until PASS.

**If PASS:**
```bash
mc artifact add {feature_id} Plan --step "Plan Review" --type plan-review-report --content {report_path}
mc step update {feature_id} Plan "Plan Review" --status completed
mc step update {feature_id} Plan --status completed
```

**Stage Gate — ask user for approval.** Present plan summary and wait for confirmation.

```bash
mc feature advance {feature_id} --approved
```

### 3. Implement Stage

Same pattern as Plan:

```bash
mc step update {feature_id} Implement --status in_progress
mc step update {feature_id} Implement Code --status in_progress
```

Dispatch scoped agents in parallel with their respective plans as input.

After both complete:

```bash
mc service status {feature_id} frontend --status completed
mc service status {feature_id} backend --status completed
mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {frontend_sha}
mc artifact add {feature_id} Implement --step Code --type implementation-commit --content {backend_sha}
mc step update {feature_id} Implement Code --status completed
```

**Step: Code Review** — same as Plan Review but checking actual code.

```bash
mc step update {feature_id} Implement "Code Review" --status in_progress
```

Dispatch `code-reviewer` (global). If FAIL, loop back to Code. If PASS:

```bash
mc artifact add {feature_id} Implement --step "Code Review" --type review-report --content {report_path}
mc step update {feature_id} Implement "Code Review" --status completed
mc step update {feature_id} Implement --status completed
```

**Stage Gate — ask user for approval.**

```bash
mc feature advance {feature_id} --approved
```

Feature is now complete.

## Agent Prompt Templates

See design spec at `docs/specs/2026-03-16-minimal-pipeline-orchestration-design.md` for the three prompt templates:
- Scoped Agent — Plan Writing
- Scoped Agent — Implementation
- Global Verifier

## Error Handling

- If a scoped agent fails: report to user, ask whether to retry or abort
- If Code Review fails: loop back to Code step with feedback
- If Plan Review fails: loop back to Write Plans step with feedback
- If `mc feature advance` fails: show validation errors, do not advance
```

- [ ] **Step 2: Commit**

```
refactor(pipeline): rewrite dispatch-pipeline skill for MC CLI
```

---

### Task 11: Update CLAUDE.md

**Repo:** `/Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator/`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace MCP references with CLI**

In `CLAUDE.md`, replace the Mission Control MCP Server section:

**Old:**
```markdown
## Mission Control MCP Server

Mission Control is an external standalone project at `~/Documents/Projects/mission-control/repos/server/`. It is referenced via `.mcp.json` with an absolute path to the server and a local `./db/mission-control.db` database.
```

**New:**
```markdown
## Mission Control CLI

Mission Control is a Python CLI installed from `~/Documents/Projects/mission-control/`. Install with `cd ~/Documents/Projects/mission-control && poetry install`. The `mc` command uses a local `./db/mission-control.db` database (set via `MC_DB` env var).

Key commands:
- `mc pipeline create --file pipelines/software-dev.yaml`
- `mc feature create --title "..." --pipeline <id>`
- `mc feature get <id>`
- `mc feature advance <id> [--approved]`
- `mc step update <feature_id> <stage> [step] --status <status>`
- `mc service register|link|status`
- `mc artifact add|get`

All commands output JSON. See `mc --help` for full usage.
```

- [ ] **Step 2: Commit**

```
docs(config): update CLAUDE.md to reference MC CLI instead of MCP server
```

---

### Task 12: End-to-End Manual Test

**Repos:** Both

This is a manual verification that the full flow works. Run these commands from the orchestrator repo root.

- [ ] **Step 1: Setup**

```bash
cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator
mc service register frontend --path ./frontend --stack sveltekit
mc service register backend --path ./backend --stack fastapi
mc pipeline create --file pipelines/software-dev.yaml
```

Capture the pipeline ID from output.

- [ ] **Step 2: Create feature**

```bash
mc feature create --title "Param Inference" --pipeline <pipeline_id>
mc service link <feature_id> frontend
mc service link <feature_id> backend
mc feature get <feature_id>
```

Verify: `current_stage` = "Plan", `status` = "active", 6 stage_progress rows all "pending".

- [ ] **Step 3: Simulate Plan stage**

```bash
mc step update <feature_id> Plan --status in_progress
mc step update <feature_id> Plan "Write Plans" --status in_progress
mc step update <feature_id> Plan "Write Plans" --status completed
mc artifact add <feature_id> Plan --step "Write Plans" --type implementation-plan --content frontend/docs/plans/param-inference.md
mc artifact add <feature_id> Plan --step "Write Plans" --type implementation-plan --content backend/docs/plans/param-inference.md
mc step update <feature_id> Plan "Plan Review" --status in_progress
mc step update <feature_id> Plan "Plan Review" --status completed
mc artifact add <feature_id> Plan --step "Plan Review" --type plan-review-report --content docs/reviews/plan-review.md
mc step update <feature_id> Plan --status completed
mc feature advance <feature_id> --approved
```

Verify: `current_stage` = "Implement".

- [ ] **Step 4: Simulate Implement stage**

```bash
mc step update <feature_id> Implement --status in_progress
mc step update <feature_id> Implement Code --status in_progress
mc step update <feature_id> Implement Code --status completed
mc artifact add <feature_id> Implement --step Code --type implementation-commit --content abc123
mc artifact add <feature_id> Implement --step Code --type implementation-commit --content def456
mc step update <feature_id> Implement "Code Review" --status in_progress
mc step update <feature_id> Implement "Code Review" --status completed
mc artifact add <feature_id> Implement --step "Code Review" --type review-report --content docs/reviews/code-review.md
mc step update <feature_id> Implement --status completed
mc feature advance <feature_id> --approved
```

Verify: `status` = "completed".

- [ ] **Step 5: Verify final state**

```bash
mc feature get <feature_id>
```

Check: all stages completed, all artifacts present, status = completed.

- [ ] **Step 6: Commit any fixes found during manual test**

If any bugs were found and fixed during manual testing, commit them.
