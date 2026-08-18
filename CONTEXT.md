# FLASHGENT — Project Context & Engineering Guide

> **Current Version**: `v0.1.7`  
> **Repository**: [https://github.com/flashback7766/flashgent](https://github.com/flashback7766/flashgent)  
> **OS Target**: Windows (x64) & Linux (x64 AppImage, deb, Arch Linux pacman)  
> **Development Environment**: Windows, Shell: PowerShell (Command chaining operator is `;`, not `&&`)

---

## 🏗️ Architectural Overview

Flashgent is a local-first, privacy-focused autonomous coding agent GUI built with Electron, React, Tailwind CSS, SQLite, and powered by local models running in LM Studio.

```
┌────────────────────────────────────────────────────────┐
│             Renderer Process (React 19 + UI)           │
│  - Zustand Store (src/renderer/store/app.ts)           │
│  - Agent Loop (src/renderer/agent/loop.ts)             │
│  - LM Studio Client (src/renderer/agent/lmstudio.ts)   │
│  - Context Budget & Compactor (agent/budget.ts)        │
│  - UI: Settings, Sidebar, ChatView, StatusBar, Popover │
└───────────────────────────▲────────────────────────────┘
                            │ contextBridge
┌───────────────────────────▼────────────────────────────┐
│         Preload Bridge (src/preload/index.ts)          │
│  Exposes window.flashgent strictly typed via shared    │
└───────────────────────────▲────────────────────────────┘
                            │ IPC (src/shared/ipc.ts)
┌───────────────────────────▼────────────────────────────┐
│              Main Process (Node.js + Electron)         │
│  - SQLite Database (src/main/db/ - better-sqlite3)     │
│  - IPC Services: fs, shell, net, llm, mcp, updater     │
│  - Benchmark Runner (src/main/ipc/benchmark.ts)        │
│  - Auto-Updater (src/main/ipc/updater.ts)              │
└────────────────────────────────────────────────────────┘
```

---

## 📁 Key Directories & File Roles

| Directory / File | Description |
|---|---|
| `src/shared/types.ts` | Canonical TypeScript domain types used across main, preload, and renderer. |
| `src/shared/ipc.ts` | IPC channel names (`CH.*`) and `FlashgentApi` interface. |
| `src/preload/index.ts` | Exposes `window.flashgent` without exposing raw Node APIs. |
| `src/main/index.ts` | Electron lifecycle, single-instance lock, window management, service registration. |
| `src/main/ipc/` | IPC handlers (`fs.ts`, `shell.ts`, `updater.ts`, `benchmark.ts`, `llm.ts`, `db.ts`, `mcp.ts`). |
| `src/renderer/agent/loop.ts` | Core agent execution loop, tool dispatching, injection defense, review workflow. |
| `src/renderer/agent/budget.ts` | Context window budgeting, prefix-stable KV cache retention, checkpointing. |
| `src/renderer/store/app.ts` | Central Zustand application state. |
| `tests/benchmark/` | 100-point benchmark dataset (30 scenarios) and execution engine (`runner.ts`). |
| `tests/e2e/` | Playwright integration test suite driven against live Electron instances. |

---

## ⚡ Core Subsystems

### 1. Smart Context Window Management
- **Historical Tool Output Compaction**: In `toWireMessages` (`src/renderer/agent/loop.ts`), tool outputs for turns older than the last 4 messages are automatically condensed to ~1200-char excerpts. This prevents 10 turns from overflowing 131k token windows.
- **Proactive Auto-Compaction**: `maybeAutoCompact` in `store/app.ts` calculates realistic token consumption across the whole conversation history and triggers compaction before the context saturation point (`autoCompactAt`).

### 2. Benchmark Suite (100-Point System)
- **Scenarios**: 30 isolated tasks in `tests/benchmark/datasets.ts`:
  - 🟢 **Easy** (15 × 1 pt = 15 pts)
  - 🟡 **Medium** (10 × 3 pts = 30 pts)
  - 🔴 **Hard** (5 × 5 pts = 25 pts)
  - ✨ **Quality Modifiers** (Tool Syntax Precision +10, Thinking Efficiency +10, Speed & Economy +10 = 30 pts)
- **Live LLM Execution**: In the GUI (Settings → Benchmark), `createLlmEvaluator` connects to the active LM Studio endpoint (`/v1/chat/completions`) and executes real tool calls in isolated sandboxes (`mkdtemp`).
- **CI Fast-Path**: Vitest (`npm test`) executes deterministic simulators in <1.5s.

### 3. In-App Auto-Updater
- Wrapped around `electron-updater` in `src/main/ipc/updater.ts`.
- Preserves all SQLite databases and configuration files in `%APPDATA%\flashgent` and `~/.flashgent` across upgrades.
- Emits download progress events to the renderer.

---

## 📋 Roadmap for v0.1.8+ (Upcoming Features)

1. **Auto-check on Startup**:
   - Trigger `autoUpdater.checkForUpdates()` silently on startup in packaged mode.
2. **Sidebar Update Button**:
   - When an update is downloaded (`updateInfo.downloaded === true`), show an interactive pill/button in the bottom-left sidebar right above the `• N models` status bar:
     > `🔄 Restart to update (v0.1.x)`
3. **Silent Installation**:
   - Ensure `autoUpdater.quitAndInstall(true, true)` runs silently without showing interactive NSIS wizard dialogs during auto-updates.
   - NSIS installer compiled with support for `/S` and `--silent` parameters.

---

## 🛠️ Verification Commands

Always run these before committing any change:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```
