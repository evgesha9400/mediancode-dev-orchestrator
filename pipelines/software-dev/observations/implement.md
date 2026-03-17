# Implement — Observations

## Param Inference (2026-03-17)

### PROBLEM: Frontend agents produce visually inconsistent UI
Every frontend agent dispatch produced components with mismatched sizing — different font sizes, padding, and heights between adjacent elements in the same view. Root cause: agents cannot see the rendered output. They write Tailwind classes based on code interpretation, not visual verification.
**Fix applied:** Added Form Component Standards to `frontend/CLAUDE.md` with exact Tailwind classes. Added Visual Consistency Rules to svelte-architect agent definition.

### PROBLEM: `/commit` skill `allowed-tools` restriction stops agent execution
The user-level `/commit` command restricts tools to git-only during the commit turn. After committing, the agent can't use Write/Edit/Bash and considers its work done. Result: agents complete exactly one task per dispatch.
**Fix applied:** Created project-level `/commit` command without `allowed-tools` restriction, with "After Committing" section directing agents to resume work.

### PROBLEM: `superpowers:executing-plans` stops for human approval
The skill pauses after each task batch for human review. When running as a subagent with no human, the agent just stops.
**Fix applied:** Created `autonomous-executing-plans` skill that never pauses.

### DECISION: Orchestrator always delegates to subagents
Never have the orchestrator do plan writing, implementation, or review inline. Context window is the scarce resource — each subagent gets a fresh context dedicated to its task.

### FRICTION: Two independent object selectors for param inference
The implementation created `TargetObjectSelector` as a separate component from `ObjectEditor`, allowing users to select two unrelated objects. The frontend has no list wrapper objects, so target always equals the response object.
**Fix applied:** Removed `targetObjectId` entirely, params resolve against `objectId`.

### FRICTION: Response shape not auto-detected from path
Users could set "List" response on a detail endpoint (`/products/{id}`), which is invalid REST. Backend validated it, but frontend didn't prevent it.
**Fix applied:** Auto-set response shape to "object" when path ends with `{param}`, disable toggle. Backend validates too.
