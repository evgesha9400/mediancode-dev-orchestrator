---
name: archive-initiative
description: Move a completed initiative's work plans from docs/work/{name}/ to docs/work/completed/{name}/. Idempotent — safe to call from multiple subagents working on the same initiative.
---

# Archive Initiative

## Overview

Move a completed initiative's work plans to the `completed/` directory and commit the result. Called automatically at the end of `autonomous-executing-plans`.

**Idempotent:** If the source directory is already gone (another subagent already archived it), skip silently.

## The Process

### Step 1: Determine the Initiative Directory

The initiative directory is the parent of the plan file that was executed. For example:
- Plan file: `docs/work/relationship-field-fixes/plan-backend.md`
- Initiative dir: `docs/work/relationship-field-fixes/`
- Initiative name: `relationship-field-fixes`

Derive these from the plan file path you loaded at the start of `autonomous-executing-plans`.

### Step 2: Check If Already Archived

```bash
ls docs/work/<initiative-name>/
```

If the source directory does not exist, it was already archived by another subagent. **Stop here — nothing to do.**

### Step 3: Ensure Destination Exists

```bash
mkdir -p docs/work/completed/
```

### Step 4: Move the Initiative Directory

```bash
mv docs/work/<initiative-name>/ docs/work/completed/<initiative-name>/
```

### Step 5: Commit

Use `/commit` with message:

```
docs(work): archive <initiative-name> plans to completed
```

## Rules

- **Always use `/commit`** — never raw `git commit`
- **Never delete** the plans — move them, preserve history
- **Idempotent** — if source is gone, exit cleanly with no error
- This skill runs in the **orchestrator repo** (`mediancode-dev-orchestrator`), not in `frontend/` or `backend/`
