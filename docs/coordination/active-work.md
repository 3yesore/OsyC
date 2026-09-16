# OsyC Active Work Register

This register prevents two agents from implementing or publishing the same line of work. It is a coordination record, not a substitute for the append-only change records in `docs/changes/`.

## Current baseline

- Current stable plug-in: `2.0.4` (published 2026-09-14). `2.0.5` has a tag but no GitHub Release, so it is not a BRAT-installable rollback target.
- Distribution repository: `3yesore/OsyC`
- Release ledger: `docs/releases/release-ledger.json` (corrected against the GitHub API on 2026-09-16)
- Last verified source commit: `af9bc5e4` on `codex/2.0.6-stabilize` (plus uncommitted 2.0.6 UI work)
- Last verified distribution commit: `bafb8392` on `main`
- Last verified release tag: `2.0.4`

## Reservations

| Task | Agent | Branch | Version reservation | Status | Handoff |
| --- | --- | --- | --- | --- | --- |
| Coordination framework bootstrap | `codex` | `codex/osyc-1.0.67-sync-entry` | None | Complete | `docs/handoff/2026-09-11-coordination-bootstrap.md` |
| OsyC title-font scope fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.76` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-title-font-scope-fix.md` |
| OsyC OC brand and entitlement copy | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.77` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-oc-brand-and-entitlement-copy.md` |
| OsyC sync/font/theme rendering fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.78` | Published test pre-release; backend deployment and mobile validation pending | `docs/handoff/2026-09-12-sync-font-theme-fix.md` |
| OsyC native settings page and account UI | `codex` | `codex/2.0.6-stabilize` | `2.0.6` (existing reservation, no new version) | Uncommitted; local checks green; mobile validation pending | `docs/handoff/2026-09-16-osyc-native-settings-page.md` |

Rules:

- The release captain owns stable reservations. The owning feature agent may create or update its own test-package reservation when the candidate is explicitly marked `test-package` and must publish it as an immutable pre-release.
- `None` means that the work must not change release metadata.
- A version reservation is unique. A second agent must use the existing task record or a different, unreserved version.
- Mark a row `Complete` only after its handoff record includes tests and known gaps.

## Open integration questions

- Name the maintainer who will own the release-captain role.
- Decide whether the next release is a stable patch or a BRAT pre-release after the current mobile review.
- Keep the current `2.0.4` Release immutable while those decisions are made.
- Decide whether the unusable `2.0.5` tag should get a GitHub Release retroactively or be documented as a dead tag; it is currently the only rollback gap.
