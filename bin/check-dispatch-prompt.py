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
