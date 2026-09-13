# OsyC Change Records

Change records are the append-only work log for feature agents. They preserve context when several agents work in parallel and make an integration decision auditable.

## Naming

Use `docs/changes/<agent>-<yyyy-mm-dd>-<short-slug>.md`. Use lower-case ASCII identifiers for the agent and slug. Do not edit or delete another agent's record. A correction is a new record linked to the earlier one.

## Required content

Every record must identify the agent, branch, related design document, version reservation, changed files, compatibility behaviour, exact verification commands, known gaps, and the requested integration action. Copy `docs/coordination/change-record-template.md`.

## Integration rule

Change records are evidence, not the formal design. The integration agent updates `docs/design/` and construction plans after reviewing the records and resolving conflicts. A record marked `integrated` must name the commit or pull request that consumed it.
