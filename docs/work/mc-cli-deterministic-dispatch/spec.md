# MC CLI — Deterministic Dispatch & Protocol Enforcement

**Status:** Backlog

## Problem

The dispatch-pipeline skill is a 150-line prose recipe that AI follows manually. The AI runs 5-6 `mc` commands per step transition, can skip steps, forget status updates, or drift from protocol. Everything deterministic is done by AI when it should be done by code.

## Goal

Move all deterministic pipeline operations into `mc` CLI commands. AI only handles creative work (writing plans, writing code, reviewing) and judgment calls (pass/fail routing, stage gates).

## Changes

### 1. Composite commands

- `mc feature init --title "..." --pipeline X --services frontend,backend` — creates feature, links services, returns feature state
- `mc step complete {fid} {stage} {step} --artifact type=X,content=Y` — marks step complete, registers artifacts, auto-transitions status

### 2. Auto status inference

- Remove manual `--status in_progress` calls
- `mc step complete` auto-sets in_progress then completed
- `mc artifact add` auto-transitions step to in_progress if pending

### 3. `mc dispatch` command

- Reads pipeline YAML for agent/skill config
- Constructs prompts from templates
- Launches agents via CLI (Claude, Codex, Gemini)
- Waits for completion, collects artifacts
- Marks step complete
- Supports `--parallel` for multi-agent steps

### 4. Protocol enforcement

- `mc step complete` rejects if required substeps aren't done
- `mc feature advance` already validates exit conditions — extend pattern

## Result

dispatch-pipeline skill shrinks to ~20 lines of decision logic. AI handles: plan writing, code writing, reviews, failure routing, stage gates. Everything else is code.
