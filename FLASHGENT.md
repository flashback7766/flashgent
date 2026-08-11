# Working on flashgent

Instructions for an agent working in this repository.

## Shape of the code

- `src/main` owns Node: window, config, SQLite, fs/shell/net/MCP services. Keep it mechanical —
  no agent logic, no business decisions. Every handler returns an `IpcResult` envelope so the
  renderer never sees a raw throw.
- `src/renderer` owns the agent: LM Studio client, tool loop, permissions, tools, UI, state.
- `src/shared` is the contract both sides compile against. A change here means updating
  `src/preload/index.ts` too, or the bridge silently drifts.
- Never reach for Node APIs from the renderer. Add an IPC channel in `src/shared/ipc.ts`,
  implement it in `src/main/ipc/`, expose it in the preload bridge.

## Conventions

- TypeScript strict, including `noUncheckedIndexedAccess`. Indexed access yields `T | undefined`;
  handle it rather than asserting.
- No `any`. No non-null assertions where a guard reads better.
- Comments explain *why*, not *what*. Match the density already in the file.
- Prettier: no semicolons, single quotes, 100 columns.

## Before calling something done

```bash
npm run typecheck && npm test
```

`npm run test:e2e` drives the real app against LM Studio. It is slow (a local model on an
integrated GPU) and needs a loadable model — run it when touching the agent loop, the LM Studio
client, or the injection defence.

## Things that will bite you

- Do not edit source files with PowerShell `Get-Content`/`Set-Content`. It round-trips through the
  system codepage and turns every em dash and `·` into mojibake. Use the editor tools.
- Reasoning tokens count against `max_tokens`. `applyEffort` adds headroom on top of the reply cap
  for exactly this reason — remove it and reasoning models return empty messages.
- A dropdown must own its trigger. When the panel handled outside-clicks itself, a click on the
  trigger counted as "outside", so it closed and the same click reopened it. `Menu` exists to make
  that impossible; do not reintroduce a bare panel.
- The global `:focus-visible` outline is suppressed on inputs and textareas. They show focus on
  their surrounding box instead, and the two together render as a doubled, misaligned ring.

- The preload bundle builds as `index.mjs`, not `.js`. `src/main/index.ts` must reference the
  `.mjs` path or the window loads with no bridge.
- `File.path` does not exist in Electron 32+. Dropped-file paths come from
  `window.flashgent.app.pathForFile(file)`, which wraps `webUtils.getPathForFile`.
- The renderer talks to LM Studio directly, so browser CORS applies. `src/main/cors.ts` relaxes
  it for configured endpoints only — do not widen that to all origins.
- `%TEMP%` is a protected location. Test fixtures that need a workspace must live elsewhere.
- Anything entering the conversation from outside the user's typing must go through
  `wrapUntrusted` in `src/renderer/agent/untrusted.ts`. If you add a tool, its output is
  fenced automatically by the loop — do not build a path that bypasses it.
