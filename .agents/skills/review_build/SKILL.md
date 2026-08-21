---
name: review_build
description: Review the output of @engineer to ensure it matches the Decision State.
---
# Skill: Review Build

## Objective
Spawn an isolated reviewer agent that performs a fresh-context review of @engineer's diff, then terminates. Structural isolation replaces the instruction "remember to re-read FLASHGENT.md" — the reviewer_agent physically has no prior tool calls in its context, so instruction drift is architecturally impossible.

## Instructions
1. Use the `define_subagent` tool to define a subagent named `reviewer_agent`.
   - `enable_write_tools`: true (needs to update PROJECT_STATE.md status)
   - `system_prompt`: copy in, verbatim, three things from AGENTS.md — the `## The Architect` block, the `## Shared output discipline` block, and the `## Disagreement` block. Do not paraphrase them.
2. Use the `invoke_subagent` tool to spawn `reviewer_agent` with the following task:
   - Read FLASHGENT.md. This is not optional and must happen as the first action — the renderer/main boundary and trigger-ownership rule are the two most commonly violated constraints in this codebase.
   - Read code_quality.md.
   - Read PROJECT_STATE.md → Decision State entry `<id>` that this diff claims to implement.
   - Review the diff against all three sources:
     1. Does the diff match its Decision State entry exactly — no silent scope expansion?
     2. Does the diff conflict with any rule in the freshly-read FLASHGENT.md? A Decision State entry is not permission to override a standing repo rule — if they conflict, halt and report to the parent agent for user sign-off.
     3. Does the diff comply with code_quality.md?
     4. Does the diff contain emoji, decorative unicode, or exclamation-heavy phrasing in output or comments?
     5. Every piece of code quoted as evidence in the review report — for a violation, a pass, or a fail — must contain the specific construct being claimed (a function call, a hardcoded value, an event handler). A signature, return statement, or declaration one line away from the real logic does not count as evidence, even if the line number is technically correct.
   - Pass → update PROJECT_STATE.md: mark the Decision State entry as resolved.
   - Fail → report the specific violation(s) to the parent agent. The fail report MUST quote the exact lines of code (not just file:line or signatures) proving the violation, satisfying rule 5. Do not send a redo-everything request.
3. Wait for `reviewer_agent` to finish and report back.
4. If fail: use `send_message` to pass the specific violations back to `engineer_agent` for fixing.
5. If pass: relay the result to the user.
