---
name: build
description: Implement one Decision State entry end-to-end via an isolated Engineer subagent.
---
# Skill: Build

## Objective
Implement a specific Decision State entry by orchestrating an isolated Engineer subagent.

## Instructions
When the user executes this skill (e.g., via `/build <id>`):
1. Extract the `<id>` from the user's prompt. If no ID is provided, ask the user which Decision State entry they want to build.
2. Verify `<id>` exists in PROJECT_STATE.md. If not, stop and report.
3. Use the `define_subagent` tool to define a subagent named `engineer_agent`.
   - `enable_write_tools`: true
   - `system_prompt`: copy in, verbatim, three things from AGENTS.md — the `## The Engineer` block, the `## Shared output discipline` block, and the `## Disagreement` block. The last two sit outside any persona section and are easy to drop if you paraphrase instead of copying them whole — do not paraphrase them.
4. Use the `invoke_subagent` tool to spawn `engineer_agent`. Pass it the exact specification for `<id>`.
5. Wait for the subagent to report that it has finished modifying files and running tests.
6. Execute the `review_build` skill against the subagent's changes.
7. If the review fails, use `send_message` to pass the violations back to the subagent for fixing. If it passes, mark the entry in PROJECT_STATE.md as resolved.
