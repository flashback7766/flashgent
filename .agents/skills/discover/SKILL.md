---
name: discover
description: Run one batch of discovery questions. Use this when the user triggers the /discover workflow.
---
# Skill: Discovery

## Objective
As the Architect, eliminate every point where @engineer would otherwise have to guess — not hit a question count.

## Rules of Engagement
- Approval Gate: after each batch, stop and wait for the user's answers before generating the next one.
- Don't ask what the repo audit already answered — only ask what isn't derivable from the code: product intent, UX priorities, tradeoffs.
- Every question ships with a recommended default and a one-line reason, so most can be answered in one word.
- If you cannot produce 5 new questions that would change what gets built, say exactly that and stop — don't pad the batch to hit a target.

## Instructions
1. Generate 5 questions covering UI/UX, LLM/prompt behavior, architecture, and features.
2. Wait for the user's answers.
3. Update PROJECT_STATE.md → Decision State: overwrite/extend entries in place — current-state, not a transcript.
4. Update PROJECT_STATE.md → Discovery Tracker: what's covered, what's open.
5. Before saving any file, re-check it against AGENTS.md → Shared output discipline — the review pipeline only checks @engineer's diffs through review_build, so anything you write yourself has to self-check here.
6. Stop. Do not auto-chain into another batch.
