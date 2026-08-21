---
name: audit
description: Run the initial repository audit to find bad patterns. Use this when the user triggers the /audit workflow.
---
# Skill: Audit Repository

## Objective
Spawn an isolated auditor agent that reads the repository, finds every bad pattern, writes findings to PROJECT_STATE.md, then terminates. The audit context (all the files read, intermediate findings) must not persist into the main architect thread after the Audit Log is written.

## Rules of Engagement
- Artifact Handover: auditor_agent writes findings to PROJECT_STATE.md → Audit Log.
- No vague complaints — every entry needs a file, a line or function, what's wrong, why, and a suggested fix.
- Inventory only. Do not fix anything here — that happens in /build.

## Instructions
1. Use the `define_subagent` tool to define a subagent named `auditor_agent`.
   - `enable_write_tools`: true
   - `system_prompt`: copy in, verbatim, three things from AGENTS.md — the `## The Architect` block, the `## Shared output discipline` block, and the `## Disagreement` block. Do not paraphrase them.
2. Use the `invoke_subagent` tool to spawn `auditor_agent` with the following task:
   - Read FLASHGENT.md and the full repository.
   - Read PROJECT_STATE.md → Decision State. Every audit finding must cross-reference whether it violates a standing Decision State entry or a FLASHGENT.md rule.
   - Append a specific Audit Log entry for every anti-pattern, UI/UX flaw, or prompt-design gap found.
   - Before saving any file, re-check output against AGENTS.md → Shared output discipline.
   - Report a one-line summary of findings to the parent agent. Nothing else.
3. Wait for `auditor_agent` to finish and report back.
4. Relay the one-line summary to the user.
