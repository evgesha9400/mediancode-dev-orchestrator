# Deterministic Observations — Orchestrator Implementation Plan

**Goal:** Add the `bin/mc` wrapper, dispatch validation hook, observation protocol in CLAUDE.md, and update the dispatch pipeline skill and commit command to use `mc dispatch render/verify`.

**Architecture:** Shell wrapper + Python hook script + Claude Code hooks config + documentation updates. No application code in this repo.

**Tech Stack:** Bash, Python, Claude Code hooks (`.claude/settings.json`)

**Spec:** `docs/work/deterministic-observations/spec.md`

**Prerequisite:** Mission Control plan must be completed first — `mc dispatch render/finalize/verify/cancel` commands must exist.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `bin/mc` | MC wrapper with dynamic MC_DB and Poetry execution |
| Create | `bin/check-dispatch-prompt.py` | PreToolUse hook script (Python) for Agent validation |
| Create | `.claude/settings.json` | Hook configuration (checked in) |
| Modify | `CLAUDE.md` | Add observation protocol section, update mc references to bin/mc |
| Modify | `.claude/commands/commit.md` | Update observation check to reference dispatch block |
| Modify | `.claude/skills/orch--dispatch-pipeline/SKILL.md` | Replace all bare mc with bin/mc, add dispatch render/verify steps |
| Delete | `.claude/skills/dispatch-pipeline/SKILL.md` | Remove duplicate skill |

---

## Tasks

### Task 1: Create `bin/mc` Wrapper

**Files:**
- Create: `bin/mc`

- [ ] **Step 1: Create the wrapper script**

```bash
#!/usr/bin/env bash
# Mission Control wrapper — resolves MC_DB dynamically and uses Poetry
# to run mc so subagents can call it from any working directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MC_DB="${REPO_ROOT}/db/mission-control.db"
MC_INSTALL="$(cd "${REPO_ROOT}/../.." 2>/dev/null && pwd)/mission-control"
exec poetry -C "${MC_INSTALL}" run mc "$@"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x bin/mc
```

- [ ] **Step 3: Verify it works**

```bash
./bin/mc --help
```

Do NOT run mutating commands (like `pipeline create`) as a smoke test — use `--help` only.

- [ ] **Step 4: Commit**

```
feat(config): add bin/mc wrapper with dynamic path resolution
```

---

### Task 2: Create Dispatch Validation Hook

**Files:**
- Create: `bin/check-dispatch-prompt.py`
- Create: `.claude/settings.json`

- [ ] **Step 1: Create the hook script in Python**

Create `bin/check-dispatch-prompt.py`:

```python
#!/usr/bin/env python3
"""PreToolUse hook for Agent tool — validates that implementation dispatches
include the observation context block from `mc dispatch render`.

Reads tool input JSON from stdin. Uses agent-type allowlist to decide
whether to enforce. Outputs JSON decision per Claude Code hooks spec.
"""
import json
import sys

# Only enforce observation context for implementation agents.
# Excludes: Explore, Plan, general-purpose, code-reviewer, etc.
ENFORCED_AGENT_TYPES = {
    "senior-code-architect-PY",
    "svelte-architect",
}

BEGIN_MARKER = "---BEGIN OBSERVATION CONTEXT---"
END_MARKER = "---END OBSERVATION CONTEXT---"


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return  # Not valid input, allow

    tool_input = data.get("tool_input", {})
    agent_type = tool_input.get("subagent_type", "")
    prompt = tool_input.get("prompt", "")

    # Skip non-implementation agent types
    if agent_type not in ENFORCED_AGENT_TYPES:
        return  # exit 0, allow

    # Check for observation context markers
    if BEGIN_MARKER in prompt and END_MARKER in prompt:
        return  # exit 0, allow

    # Block: implementation dispatch missing observation context
    decision = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "Implementation dispatch missing observation context block. "
                "Run: bin/mc dispatch render <feature_id> <stage> "
                "--service-name <svc> --agent-name <agent> --mc-path $(pwd)/bin/mc"
            ),
        }
    }
    json.dump(decision, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make executable**

```bash
chmod +x bin/check-dispatch-prompt.py
```

- [ ] **Step 3: Add hook configuration**

Create `.claude/settings.json` (project-level, checked in):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "python3 bin/check-dispatch-prompt.py"
          }
        ]
      }
    ]
  }
}
```

Note: uses relative path `bin/check-dispatch-prompt.py` — Claude Code runs hooks from the project root. The existing `.claude/settings.local.json` has permissions and MCP config — the checked-in `.claude/settings.json` is separate and Claude Code merges both.

- [ ] **Step 4: Test the hook**

```bash
# Should allow (not an enforced agent type)
echo '{"tool_input": {"subagent_type": "Explore", "prompt": "Find files"}}' | python3 bin/check-dispatch-prompt.py
echo "Exit code: $?"
# Expected: exit 0, no output

# Should deny (enforced agent, missing block)
echo '{"tool_input": {"subagent_type": "senior-code-architect-PY", "prompt": "You are working on the backend. Execute Task 1."}}' | python3 bin/check-dispatch-prompt.py
echo "Exit code: $?"
# Expected: exit 0, JSON deny decision

# Should allow (enforced agent, block present)
echo '{"tool_input": {"subagent_type": "svelte-architect", "prompt": "---BEGIN OBSERVATION CONTEXT---\ntest\n---END OBSERVATION CONTEXT---\nExecute Task 1."}}' | python3 bin/check-dispatch-prompt.py
echo "Exit code: $?"
# Expected: exit 0, no output

# Should allow (general-purpose, not enforced)
echo '{"tool_input": {"subagent_type": "general-purpose", "prompt": "Run Gemini CLI to consult on a design question. This is an implementation review."}}' | python3 bin/check-dispatch-prompt.py
echo "Exit code: $?"
# Expected: exit 0, no output
```

- [ ] **Step 5: Commit**

```
feat(config): add PreToolUse hook to validate observation context in agent dispatches

- Python hook script with agent-type allowlist enforcement
- Only blocks senior-code-architect-PY and svelte-architect without context
- Uses Claude Code hooks JSON decision format
```

---

### Task 3: Update CLAUDE.md, commit.md, and Dispatch Skill

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/commit.md`
- Modify: `.claude/skills/orch--dispatch-pipeline/SKILL.md`
- Delete: `.claude/skills/dispatch-pipeline/SKILL.md`

- [ ] **Step 1: Add observation protocol to root CLAUDE.md**

Add a new section after the "Subagent Scoping" section:

```markdown
## Observation Protocol — MANDATORY

All implementation subagent dispatches MUST include an observation context block.

### For the orchestrator (dispatching agents):
1. Run `bin/mc dispatch render <feature_id> <stage> --service-name <svc> --agent-name <agent> --mc-path $(pwd)/bin/mc`
2. Paste the output block verbatim into the Agent prompt
3. After the subagent returns, run `bin/mc dispatch verify <dispatch_id>` — do NOT proceed if it fails
4. After the stage completes, run `bin/mc observation consolidate <feature_id> --output-dir pipelines/software-dev/observations/ --feature-title "<title>"`

The `bin/mc` wrapper handles PATH and database location. Never use bare `mc`.

### For subagents (if you see an observation context block in your prompt):
- Record observations immediately when trigger conditions fire — don't wait for a commit
- Use the exact command template from the block
- Run `dispatch finalize` before returning your results
```

- [ ] **Step 2: Replace all bare `mc` with `bin/mc` in CLAUDE.md**

In the "Mission Control CLI" section, update:
- All `mc` command examples to use `bin/mc`
- The description to mention the wrapper

- [ ] **Step 3: Update commit.md observation check**

In `.claude/commands/commit.md`, replace the "Observation Check" section (lines 73-90). Replace the hardcoded `mc observation add <feature_id> <stage> ...` command template with:

```markdown
## Observation Check

Before resuming your task, briefly assess: did completing this task involve
any of the following that you have NOT already recorded an observation for?

- **PROBLEM**: Something broke unexpectedly, requiring a fix not anticipated by the plan
- **DECISION**: A judgment call between alternatives that could affect future work
- **FRICTION**: Something harder than it should have been — missing abstraction, unclear convention, tool limitation, or workaround

If YES to any and your prompt includes an observation context block:
use the exact command template from that block to record the observation.

If YES but no observation context block is in your prompt:
note the observation in your response so the orchestrator can record it.

If NO: resume immediately. Do not record anything. Do not mention that you checked.
```

- [ ] **Step 4: Update orch--dispatch-pipeline skill — replace ALL bare `mc`**

In `.claude/skills/orch--dispatch-pipeline/SKILL.md`, replace every instance of bare `mc` with `bin/mc`. This includes:
- Prerequisites section (lines 14-19)
- Feature creation (lines 26-31)
- Step updates (all `mc step update` calls)
- Service commands (all `mc service` calls)
- Artifact commands (all `mc artifact add` calls)
- Feature advance (all `mc feature advance` calls)
- Observation consolidate calls
- Error handling section

- [ ] **Step 5: Update dispatch sections to use `dispatch render` + `dispatch verify`**

Replace the Plan stage frontend agent dispatch (lines 46-49):

```markdown
**Frontend agent** — `svelte-architect` subagent scoped to `frontend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} plan --service-name frontend --agent-name svelte-architect --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Plan Writing template with `{feature_spec_content}` injected + observation context block
- Output: `docs/work/{feature_slug}/plan-frontend.md`
```

Replace the Plan stage backend agent dispatch (lines 52-54):

```markdown
**Backend agent** — `senior-code-architect-PY` subagent scoped to `backend/`:
- Generate observation context: `bin/mc dispatch render {feature_id} plan --service-name backend --agent-name senior-code-architect-PY --mc-path $(pwd)/bin/mc`
- Include the full output block in the Agent prompt
- Prompt: Plan Writing template with `{feature_spec_content}` injected + observation context block
- Output: `docs/work/{feature_slug}/plan-backend.md`
```

After "After both complete:" (line 57), add dispatch verification before proceeding:

```markdown
**Verify dispatches finalized:**

```bash
bin/mc dispatch verify {fe_dispatch_id}
bin/mc dispatch verify {be_dispatch_id}
```

If either fails, the subagent did not finalize. Report to user.
```

Apply the same pattern to the Implement stage dispatches (lines 117-121).

- [ ] **Step 6: Delete duplicate dispatch skill**

```bash
rm .claude/skills/dispatch-pipeline/SKILL.md
rmdir .claude/skills/dispatch-pipeline/
```

- [ ] **Step 7: Commit**

```
feat(config): enforce observation protocol across dispatch pipeline

- Add observation protocol to root CLAUDE.md
- Update commit.md to reference dispatch block instead of hardcoded command
- Replace all bare mc with bin/mc in dispatch pipeline skill
- Add dispatch render and dispatch verify steps to dispatch pipeline
- Delete duplicate dispatch-pipeline skill
```

---

### Task 4: Verification

- [ ] **Step 1: Verify bin/mc works**

```bash
./bin/mc --help
```

- [ ] **Step 2: Verify hook denies missing context**

```bash
echo '{"tool_input": {"subagent_type": "senior-code-architect-PY", "prompt": "Execute Task 1."}}' | python3 bin/check-dispatch-prompt.py | python3 -m json.tool
# Expected: JSON with permissionDecision: deny
```

- [ ] **Step 3: Verify hook allows with context**

```bash
echo '{"tool_input": {"subagent_type": "svelte-architect", "prompt": "---BEGIN OBSERVATION CONTEXT---\ntest\n---END OBSERVATION CONTEXT---"}}' | python3 bin/check-dispatch-prompt.py
# Expected: no output (allowed)
```

- [ ] **Step 4: Verify hook allows non-enforced agents**

```bash
echo '{"tool_input": {"subagent_type": "general-purpose", "prompt": "Long analysis prompt about implementation and execution"}}' | python3 bin/check-dispatch-prompt.py
# Expected: no output (allowed)
```

- [ ] **Step 5: Check for remaining bare `mc` in instruction files**

Search for bare `mc ` commands (space after mc, not `bin/mc`) in all instruction files:

```bash
grep -rn "^mc \|[^/]mc " CLAUDE.md .claude/CLAUDE.md .claude/skills/ .claude/commands/ --include="*.md" | grep -v "bin/mc" | grep -v "^#" | grep -v "\.venv"
```

Any hits need updating to `bin/mc`.

- [ ] **Step 6: Verify settings.json doesn't conflict with settings.local.json**

Read both files and confirm no overlapping keys.
