# Project State

## Decision State
Current architecture and confirmed choices only — living document, not a transcript. Overwrite an entry when superseded.
Format: `- [D1] <decision> — <rationale>`
- [D1] Agent Loop stays in Renderer; heavy LLM JSON parsing and token calculation moved to a Web Worker — FLASHGENT.md explicitly forbids agent logic and business decisions in Main ("Keep it mechanical"). The original D1 phrasing ("Agent Loop in Main process") was overly broad and silently violated this standing rule. The correct fix is a Web Worker inside the Renderer, not a move to Main.
- [D2] Drizzle ORM for SQLite — provides auto-migrations and strict end-to-end type safety across the IPC bridge.
- [D3] UI Framework: Radix UI primitives + Tailwind CSS (shadcn/ui pattern) — guarantees absolute maximum customizability for a unique look while providing flawless out-of-the-box accessibility and popover logic.
- [D4] State Management: Zustand with strict feature slices — chosen for maximum render optimization and smoothness, providing speed without the massive boilerplate overhead of XState.
- [D5] Chat History: Tree structure (branching) — allows users to edit past messages and switch between alternate generation paths like ChatGPT.
- [D6] Multi-Agent UI: Visually separate agents — display distinct avatars/tags (Architect vs Engineer) so the user understands exactly who is working and what their constraints are.
- [D7] IPC Strict Typing: Zod schemas on both ends — prevents silent drifts between main and renderer payloads.
- [D8] File/Diff Presentation: Unified inline diff blocks — keeps edit context directly within the flow of conversation.
- [D9] No proprietary cloud APIs (Claude/GPT/Gemini). Any OpenAI-compatible endpoint is allowed — local LM Studio, a remote self-hosted instance, OpenRouter, etc. The policy is proprietary-vs-open standard, not local-vs-network.
- [D10] Multi-Agent Execution UI: Stream all agent chatter directly into the main chat — provides maximum transparency of internal agent communication.
- [D11] Web Worker for heavy renderer-side computation — token calculation and LLM JSON parsing are offloaded to a dedicated Worker spawned once at agent session start and terminated on session end. Boundary: Worker receives raw response chunks via postMessage (structured clone), returns parsed token counts and compacted message objects. No agent logic, no tool dispatch, no LM Studio client inside the Worker — those stay in loop.ts on the main renderer thread.
- [D12] Security / Prompt Injection: Wrap untrusted content in strict XML tags and instruct the system prompt to ignore embedded commands — mitigates malicious inputs from external files or web pages while keeping implementation lightweight.
- [D13] Tool Approval UX: Multi-mode system (Plan: only read/analyze tools; Manual: explicit approval for modifying actions; Auto: agent self-evaluates; Bypass Permissions: allow all) — provides flexibility for varying user trust levels and workflow needs.
- [D14] Context Compaction Visibility: Add an explicit system message to the chat saying "Context compressed" — provides transparency when history is summarized or pruned, preventing silent loss of context.
- [D15] Context Compaction Trigger: Trigger at 80% of the current model's maximum context window — balances leaving enough headroom for large responses with delaying expensive compaction as long as possible.
- [D16] Update Rollback Policy: Keep previous version intact; if an auto-update fails, notify user to manually download from website — avoids complex automatic rollback logic while preventing the app from being bricked.
- [D17] Tool Execution Environment: Direct execution in host shell (subject to approval modes) — allows natural interactions with local build tools without the overhead of Docker.
- [D18] Workspace File Constraints: Prompt the user for permission anytime a file outside the active workspace is accessed — maintains a security boundary while supporting necessary external file access.
- [D19] System Prompt Customization: Core prompts are locked; users can only append custom instructions. Explicitly: no UI, API, or future internal component (including debug/admin views) gets read/write access to the core system prompt. The append-only boundary is a deliberate security constraint, not a missing feature — ensures agents adhere to defined constraints while allowing lightweight personalization.
- [D20] Conversation Export: Support exporting chats to Markdown — provides an easy, human-readable format for sharing or archiving agent conversations.
- [D21] Cost Control: Allow unlimited autonomous turns but show a running estimated cost counter in the UI — keeps the agent capable of long-running tasks while keeping the user informed of spending when using priced OpenAI-compatible endpoints (like OpenRouter).
- [D22] Native OS Integration: Close to system tray — allows background tasks (like long builds or persistent agent loops) to continue without forcing the main window to stay open. Note: The app being tray-resident does *not* constitute "session end" for the [D11] Worker lifecycle; the Worker persists as long as the agent session is active in the background.
- [D23] Auto-Updater Strategy: Download updates silently in the background and show a "Restart to update to [version]" button — provides a frictionless update experience without interrupting the user's workflow.
- [D24] Onboarding UX: Show an onboarding wizard directing the user to download LM Studio and a recommended model, OR configure a custom OpenAI-compatible endpoint (local or remote) — ensures a smooth setup process without forcing a single path or bloating the app size with bundled models.
- [D25] Telemetry/Analytics: Opt-in telemetry, defaulting to off, asked on first launch. Note: If opted-in, collection continues during background tray activity (as the agent loop and Worker remain active per [D22]) — respects user privacy while allowing the collection of crucial usage and error data if the user consents.
- [D26] Crash Recovery: Persist agent state to SQLite at every step; on restart, resume the loop from the last completed tool call — prevents total loss of progress during long tasks if the Renderer crashes.
- [D27] Migration Sequencing: Run Drizzle schema migrations synchronously in the Main process on startup before the Renderer loads. Failure behavior: If the migration throws, the app refuses to launch and displays a fatal error screen with logs (no automatic schema rollback, to avoid accidental data loss) — guarantees the app won't launch on a broken schema following an update [D23].
- [D28] Tool Concurrency: Strict sequential execution only (no parallel tool calls) — guarantees deterministic file writes and prevents race conditions, prioritizing correctness over raw speed. Note: [D26]'s crash-recovery semantics strictly depend on this sequential guarantee. Any future change allowing parallelism here MUST also revise [D26] to handle ambiguous in-flight states.
- [D29] Self-Hosted Build Roadmap: Flashgent is currently built via external tools due to compute/budget constraints, but the long-term direction is self-hosted build capability (Flashgent building itself). Note: [D19]'s append-only boundary applies equally to Flashgent's own agent loop in this hypothetical self-build mode, not just external user-facing UI.

## Audit Log
Append-only, timestamped.
Format: `- [YYYY-MM-DD] <file:line> — <what's wrong> — <why> — <fix> — status: open/resolved`
- [2026-08-21] src/renderer/store/app.ts:1107 — Token calculation runs synchronously on main thread — violates [D1] and [D11] which mandate Web Worker for JSON parsing/token calculation — move to dedicated Worker — status: resolved
- [2026-08-21] src/main/db/index.ts:133 — Uses raw better-sqlite3 queries instead of Drizzle ORM — violates [D2] — rewrite DB access using Drizzle ORM — status: resolved
- [2026-08-21] package.json:35 — Missing Radix UI dependencies — violates [D3] which mandates Radix UI primitives — implement Radix UI primitives — status: resolved
- [2026-08-21] src/renderer/components/MessageView.tsx:225 — Missing distinct avatars/tags for agents — violates [D6] which mandates visual agent separation — add visual agent identification — status: resolved
- [2026-08-21] src/renderer/store/app.ts:872 — Subtask blocks are silently swallowed instead of streamed — violates [D10] which mandates streaming all chatter — emit subtask blocks to main chat — status: resolved
- [2026-08-21] src/renderer/components/Popover.tsx:28 — Bare panel that manually handles outside clicks — violates FLASHGENT.md rule requiring Menu to own its trigger — replace with Menu or wrap trigger — status: resolved
*Note: The following 5 entries regarding [D9] hardcoding form one atomic refactor (LmStudioClient -> OpenAIApiClient rename + fallback removal). They MUST be built together in a single pass to prevent a broken intermediate state where some call sites use the old class name.*
- [2026-08-21] src/shared/config.ts:31 — Default endpoint hardcoded to 'LM Studio (local)' and 'http://localhost:1234/v1' — violates updated [D9] (OpenAI-compatible endpoints can be remote) — abstract default config and naming — status: resolved
- [2026-08-21] src/main/configStore.ts:48 — Fallback base URL hardcoded to 'http://localhost:1234/v1' — violates updated [D9] — remove hardcoded fallback or make it configurable — status: resolved
- [2026-08-21] src/main/ipc/benchmark.ts:33 — Fallback base URL hardcoded to 'http://localhost:1234/v1' — violates updated [D9] — use config store active endpoint without hardcoded fallback — status: resolved
- [2026-08-21] src/renderer/store/app.ts:1145 — Fallback base URL hardcoded and coupled to 'LmStudioClient' — violates updated [D9] — rename LmStudioClient to OpenAIApiClient and rely on config base URL — status: resolved
- [2026-08-21] src/renderer/agent/lmstudio.ts:70 — Class named 'LmStudioClient' assuming local LM Studio semantics instead of agnostic OpenAI endpoint — violates updated [D9] — rename to OpenAIApiClient and generalize error handling/capabilities — status: resolved

## Discovery Tracker
Batches run, categories fully covered, categories still open. Track coverage, not a target count.
- Batches run: 6 (Core Architecture & UI Paradigm; IPC, UI/UX, & Providers; Security, UX, Performance, Reliability; Features & Cost Control; Native OS, Onboarding & Telemetry; Architectural Gaps: Recovery, Migrations, Concurrency)
- Categories fully covered: Agent Loop Location, DB ORM, UI Component Strategy, State Management, History Structure, Multi-Agent Visualization, IPC strict typing, File/Diff presentation, Model provider abstraction, Multi-Agent Execution UI, Injection defense, Approval UX, Context compaction visibility, Context compaction trigger, Update rollback policy, Tool execution environment, Workspace constraints, Prompt customization, Conversation export, Cost control, Native OS integration, Auto-updater strategy, Onboarding UX, Telemetry/Analytics, Crash recovery, Migration sequencing, Tool concurrency.
- Categories still open (ordered by risk, not recording order): None.

## Build Plan

### Phase 1: Existing Violations (Audit Log)
*Ordered by structural dependency. (Note: The `engineer_agent` reads live repo state from disk during each step. Step 3 will natively see and build upon the `app.ts` changes committed by Step 1).*
1. **[D9]** Provider Abstraction: Atomic refactor (LmStudioClient -> OpenAIApiClient + remove hardcoded fallbacks). (Foundation: provider layer)
2. **[D2]** DB ORM: Rewrite raw sqlite3 queries to use Drizzle ORM. (Foundation: data layer)
3. **[D1], [D11]** Worker Boundaries: Move synchronous token calculation to the dedicated Web Worker. (Foundation: concurrency)
4. **[D10]** Agent UX: Stream subtask blocks to the main chat instead of silently swallowing them. (Depends on agent loop)
5. **[D3]** UI Framework: Install Radix UI dependencies and replace bare Popover with Radix primitives. (Foundation: UI)
6. **[D6]** Agent UI: Add distinct avatars/tags to `MessageView`. (Depends on UI framework)

### Phase 2: Unbuilt Features
*Ordered by structural dependency. (Note: Some may already be partially implemented; to be verified during execution).*
1. **[D7]** IPC Strict Typing (Zod schemas) — Foundation for all Main/Renderer communication.
2. **[D27]** Migration Sequencing — Synchronous Drizzle startup (Depends on D2).
3. **[D4]** State Management (Zustand) — Data flow foundation.
4. **[D5]** Chat History (Tree structure) — Core data structure for conversations.
5. **[D28]** Tool Concurrency (Sequential) — Core loop guarantee.
6. **[D26]** Crash Recovery (Persist state) — Depends on D2, D27, and D28.
7. **[D12]** Prompt Injection Defense — Core LLM input formatting.
8. **[D14], [D15]** Context Compaction (Trigger & Visibility) — Token budget management.
9. **[D13]** Tool Approval UX (Multi-mode) — UX and approval gate for executing tools.
10. **[D18]** Workspace File Constraints (Prompt outside active workspace) — Security boundary.
11. **[D17]** Tool Execution Environment (Host shell) — Core capabilities (Depends on D13 and D18 constraints).
12. **[D8]** File/Diff Presentation (Inline diff blocks) — UI components.
13. **[D19]** System Prompt Customization (Locked core, append-only) — Settings UI constraint.
14. **[D20]** Conversation Export (Markdown) — Feature.
15. **[D21]** Cost Control Counter — UI feature relying on token tracking.
16. **[D24]** Onboarding UX (Wizard) — Initial user flow.
17. **[D22]** Native OS Integration (Close to tray) — App lifecycle.
18. **[D23], [D16]** Auto-Updater Strategy & Rollback Policy — Packaging/Lifecycle.
19. **[D25]** Telemetry/Analytics — Background service.

*Note: **[D29]** (Self-Hosted Build Roadmap) is explicitly non-actionable for v0.3.0 and is tracked purely for future architectural alignment.*