---
description: Consult three LLMs (Gemini, Codex, Claude) in parallel on a design question
---

## Input

The user's question or design problem: $ARGUMENTS

## Your Task

You are the orchestrator. You will send the same question to three LLMs in parallel and present their responses for comparison.

### Repo Paths

| Alias | Absolute path |
|-------|---------------|
| orchestrator | /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-dev-orchestrator |
| frontend | /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-frontend |
| backend | /Users/evgesha/Documents/Projects/mediancode/repos/mediancode-backend |
| mission-control | /Users/evgesha/Documents/Projects/mission-control |

### Step 1: Assess Repo Access

Based on the question, decide which repos each model needs access to:

| Question type | Repo access |
|--------------|-------------|
| Backend code generation, models, templates, ORM | Backend only |
| Frontend components, stores, UI logic | Frontend only |
| Cross-cutting design, API contracts, full pipeline | Both |
| Pure architecture, philosophy, abstract design | None (philosophy doc only) |
| Pipeline, orchestration, Mission Control | Orchestrator + Mission Control |

### Step 2: Read the Philosophy Document

Read `docs/PHILOSOPHY.md` from the orchestrator repo. You MUST include it in every prompt sent to the three models.

### Step 3: Build the Prompt

Construct a prompt that includes:
1. Role: "You are a senior API/software architect consulting on Median Code, a deterministic code generator for FastAPI APIs."
2. If repo access is needed: "Before answering, explore the codebase you are in. Look at [relevant files]. Understand how the system works today."
3. The full philosophy document
4. The user's question exactly as provided
5. File/directory references as paths (e.g., "See `pipelines/software-dev/observations/implement.md` for the current format"). Do NOT inline file contents — give paths so the models can read them in their own context.
6. "Reference specific files and current patterns where relevant. Explain how your proposal maps to the philosophy framework."

### Step 3.5: Present Prompt for User Approval

Present the constructed prompt to the user in a fenced code block:

```
Here is the prompt I will send to all three models:

---
{the full prompt text}
---

Files/directories referenced:
- {list of paths the models will be pointed to}

Target repos: {which repos each model will run in}
```

Then ask the user: "Ready to send, or would you like to refine it?"

**Iteration loop:** If the user requests changes, update the prompt and present it again. Repeat until the user confirms. Do NOT dispatch agents until the user explicitly approves.

### Step 4: Launch Three Agents in Parallel

Launch all three as background agents in a SINGLE message (parallel dispatch):

**Agent 1 — Gemini 3.1 Pro Preview:**
- Use the Agent tool with `subagent_type: "general-purpose"`
- The agent must run Gemini from the **primary repo** for the question, with `--include-directories` for all other relevant repos
- Command pattern:
  ```
  cd <primary_repo> && gemini -m gemini-3.1-pro-preview \
    --include-directories <additional_repo_1> \
    --include-directories <additional_repo_2> \
    -p '<prompt>'
  ```
- Choose the primary repo based on the question type (backend-heavy → backend, frontend-heavy → frontend, orchestration → orchestrator)
- IMPORTANT: Always use ABSOLUTE repo paths from the table above, never symlinks
- Tell the agent to return the FULL response, not summarized

**Agent 2 — Codex GPT-5.4:**
- Use the Agent tool with `subagent_type: "general-purpose"`
- The agent must run Codex from the **primary repo**, with `--add-dir` for all other relevant repos
- Command pattern:
  ```
  cd <primary_repo> && codex exec -m gpt-5.4 --full-auto \
    --add-dir <additional_repo_1> \
    --add-dir <additional_repo_2> \
    '<prompt>'
  ```
- Choose the primary repo same as Gemini
- Tell the agent to return the FULL response, not summarized

**Agent 3 — Claude (subagent):**
- Use the Agent tool with `subagent_type: "senior-code-architect-PY"` for backend questions, `subagent_type: "svelte-architect"` for frontend questions, or `subagent_type: "general-purpose"` for cross-cutting/abstract questions
- Pass the same prompt directly (no CLI needed — Claude runs natively)
- Claude subagents can read any file via absolute paths. Include the relevant repo paths in the prompt so it knows where to look.
- Include instruction: "Do NOT make any code changes — analysis only"
- Tell the agent to return the FULL response

### Step 5: Present Results

Once all three respond, present:
1. Each model's full response (or a clear summary if very long)
2. A comparison table showing where they agree and disagree
3. Your own brief assessment of which arguments are strongest

## Important Notes

- ALWAYS use `gemini-3.1-pro-preview` for Gemini (latest model)
- ALWAYS use `gpt-5.4` for Codex with xhigh reasoning (already configured as default)
- NEVER summarize individual responses unless they exceed ~500 words — the user wants full reasoning
- If a model fails to launch (wrong model name, sandbox error), report the error and retry with a fix
- The user may ask follow-up questions — you can resume any of the three agents to continue the conversation
