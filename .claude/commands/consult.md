---
description: Consult three LLMs (Gemini, Codex, Claude) in parallel on a design question
---

## Input

The user's question or design problem: $ARGUMENTS

## Your Task

You are the orchestrator. You will send the same question to three LLMs in parallel and present their responses for comparison.

### Step 1: Assess Repo Access

Based on the question, decide which repos each model needs access to:

| Question type | Repo access |
|--------------|-------------|
| Backend code generation, models, templates, ORM | Backend only |
| Frontend components, stores, UI logic | Frontend only |
| Cross-cutting design, API contracts, full pipeline | Both |
| Pure architecture, philosophy, abstract design | None (philosophy doc only) |

### Step 2: Read the Philosophy Document

Read `docs/PHILOSOPHY.md` from the orchestrator repo. You MUST include it in every prompt sent to the three models.

### Step 3: Build the Prompt

Construct a prompt that includes:
1. Role: "You are a senior API/software architect consulting on Median Code, a deterministic code generator for FastAPI APIs."
2. If repo access is needed: "Before answering, explore the codebase you are in. Look at [relevant files]. Understand how the system works today."
3. The full philosophy document
4. The user's question exactly as provided
5. "Reference specific files and current patterns where relevant. Explain how your proposal maps to the philosophy framework."

### Step 4: Launch Three Agents in Parallel

Launch all three as background agents in a SINGLE message (parallel dispatch):

**Agent 1 — Gemini 3.1 Pro Preview:**
- Use the Agent tool with `subagent_type: "general-purpose"`
- The agent must run: `cd <repo_path> && gemini -m gemini-3.1-pro-preview -p '<prompt>'`
- For backend access: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-backend`
- For frontend access: `cd /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend`
- For both: run from backend (Gemini can only access one workspace; backend is usually more relevant for architecture questions)
- For none: run from the orchestrator repo
- IMPORTANT: Always use the ACTUAL repo paths, never symlinks. Gemini's sandbox blocks symlink traversal.
- Tell the agent to return the FULL response, not summarized

**Agent 2 — Codex GPT-5.4:**
- Use the Agent tool with `subagent_type: "general-purpose"`
- The agent must run: `cd <repo_path> && codex exec -m gpt-5.4 --full-auto '<prompt>'`
- Same repo path logic as Gemini, but Codex can follow symlinks so either path works
- Tell the agent to return the FULL response, not summarized

**Agent 3 — Claude (subagent):**
- Use the Agent tool with `subagent_type: "senior-code-architect-PY"` for backend questions, `subagent_type: "svelte-architect"` for frontend questions, or `subagent_type: "general-purpose"` for cross-cutting/abstract questions
- Pass the same prompt directly (no CLI needed — Claude runs natively)
- Include instruction: "Do NOT make any code changes — analysis only"
- Tell the agent to return the FULL response

### Step 5: Present Results

Once all three respond, present:
1. Each model's full response (or a clear summary if very long)
2. A comparison table showing where they agree and disagree
3. Your own brief assessment of which arguments are strongest

## Important Notes

- ALWAYS use `gemini-3.1-pro-preview` for Gemini (latest model)
- ALWAYS use `gpt-5.4` for Codex (already configured as default with xhigh reasoning)
- NEVER summarize individual responses unless they exceed ~500 words — the user wants full reasoning
- If a model fails to launch (wrong model name, sandbox error), report the error and retry with a fix
- The user may ask follow-up questions — you can resume any of the three agents to continue the conversation
