# OsyC Active Work Register

This register prevents two agents from implementing or publishing the same line of work. It is a coordination record, not a substitute for the append-only change records in `docs/changes/`.

## Current baseline

- Current stable plug-in: `1.0.75`
- Distribution repository: `3yesore/OsyC`
- Release ledger: `docs/releases/release-ledger.json`
- Last verified source commit: `8bbeedd8`
- Last verified distribution commit: `a1f1085`
- Last verified release tag: `1.0.75`

## Reservations

| Task | Agent | Branch | Version reservation | Status | Handoff |
| --- | --- | --- | --- | --- | --- |
| Coordination framework bootstrap | `codex` | `codex/osyc-1.0.67-sync-entry` | None | Complete | `docs/handoff/2026-09-11-coordination-bootstrap.md` |
| OsyC title-font scope fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.76` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-title-font-scope-fix.md` |
| OsyC OC brand and entitlement copy | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.77` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-oc-brand-and-entitlement-copy.md` |
| OsyC sync/font/theme rendering fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.78` | Published test pre-release; backend deployment and mobile validation pending | `docs/handoff/2026-09-12-sync-font-theme-fix.md` |

Rules:

- The release captain owns stable reservations. The owning feature agent may create or update its own test-package reservation when the candidate is explicitly marked `test-package` and must publish it as an immutable pre-release.
- `None` means that the work must not change release metadata.
- A version reservation is unique. A second agent must use the existing task record or a different, unreserved version.
- Mark a row `Complete` only after its handoff record includes tests and known gaps.

## Open integration questions

- Name the maintainer who will own the release-captain role.
- Decide whether the next release is a stable patch or a BRAT pre-release after the current mobile review.
- Keep the current `1.0.75` Release immutable while those decisions are made.
