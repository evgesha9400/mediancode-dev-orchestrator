---
name: fe--delete-dirs
description: MANDATORY for ANY directory deletion in frontend (node_modules, .svelte-kit, worktrees, build, ANY dir) — bun hardlinks break rm -rf on macOS. Use find -delete instead. NO EXCEPTIONS.
---

**NEVER use `rm -rf` on any directory in the frontend repo.** Always use `find <dir> -delete` which works reliably with bun's hardlinks on macOS. **NEVER use git worktrees** — `git worktree remove` uses `rm` internally and will hang. Use feature branches instead.
