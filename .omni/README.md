# .omni/ — agent runtime workspace

Runtime assets the Omni agent reads and writes at run time. Committed to the repo so
the agent always has a known layout; **contents of `memory/` are git-ignored**.

| Directory  | Purpose                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `agents/`   | Agent definitions (roles, personas, system prompts). One file per agent. |
| `skills/`   | Reusable skills the agent can load and self-improve.                    |
| `policies/` | Guardrails: approval rules, command allow/deny lists, sandbox limits.   |
| `memory/`   | SQLite memory database (FTS5). Runtime data — not committed.            |

Layout is created on first run; keep the `.gitkeep` files so empty folders survive cloning.
