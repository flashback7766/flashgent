# Skill: Code Quality Bar

Applies to every file @engineer writes or touches.

## TypeScript
- Strict mode, no `any`, no non-null assertions without a comment justifying them.
- Exhaustive handling on unions/enums — no silent default branch on a switch over a closed type.
- No implicit returns.

## Python
- Type hints on every function signature.
- No bare `except:`.
- No mutable default arguments.
- dataclass/pydantic over untyped dicts once a shape is used more than once.

## Dependencies
Native APIs first. A new dependency is justified only if it removes roughly 100+ LOC of nontrivial logic, or covers something genuinely hard to get right (crypto, parsing, concurrency). State the tradeoff, ask before adding.

## Hygiene
No dead code, no commented-out blocks, no TODO without a pointer back to a Decision or Audit entry. Every new function/module gets a comment stating intent, not restating the code.

## Secrets
No API keys, tokens, or credentials hardcoded or logged, ever — env vars only, scrub before anything reaches output shown to the user.
