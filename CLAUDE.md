# CLAUDE.md — Median Code Orchestration

## Overview

This is the orchestration repo for Median Code. It contains:
- `mission-control/` — MCP server for pipeline orchestration (extractable, domain-agnostic)
- `pipelines/` — Pipeline templates (YAML)
- `docs/stages/` — Living documents for the self-improving learning system
- `frontend/` — Symlink to the frontend repo (SvelteKit)
- `backend/` — Symlink to the backend repo (FastAPI)

## Repo Structure

The frontend and backend repos are independent git repositories symlinked into this workspace. They have their own CLAUDE.md files, skills, and CI/CD. This repo coordinates work across them.

## Mission Control MCP Server

The `mission-control/` directory is a self-contained Node.js package. It has zero coupling to Median Code — no hardcoded paths, no Median-specific logic. Everything is configured via pipeline templates and service registration at runtime.

```bash
cd mission-control && npm test    # Run MCP server tests
cd mission-control && npm run build  # Build
```

## Cross-Repo Coordination

When working on features that span frontend and backend:
1. Query Mission Control for current feature status: `list_features`
2. Check which services are affected: `get_feature_services`
3. Update progress as you work: `update_step_status`, `update_service_status`
4. Read living documents before executing any stage/step
5. Write observations to living documents after completing work

## Pipeline Templates

Pipeline templates live in `pipelines/` as YAML files. See `pipelines/software-dev.yaml` for the software development pipeline.

## Living Documents

Living documents in `docs/stages/` accumulate learnings across features. Agents read them before executing and write observations after completing work. See the design spec for the full learning system description.

## Commit Messages

Follow Conventional Commits: `<type>(<scope>): <subject>`
Scopes: `mcp`, `pipeline`, `docs`, `config`
