# OsyC Active Work Register

This register prevents two agents from implementing or publishing the same line of work. It is a coordination record, not a substitute for the append-only change records in `docs/changes/`.

## Current baseline

- Current stable plug-in: `2.0.4` (published 2026-09-14). `2.0.5` has a tag but no GitHub Release, so it is not a BRAT-installable rollback target.
- Current pre-release: `2.0.6` (published 2026-09-16 as a GitHub pre-release for BRAT mobile validation; not a stable promotion).
- Distribution repository: `3yesore/OsyC`
- Release ledger: `docs/releases/release-ledger.json` (updated 2026-09-16 with the `2.0.6` pre-release)
- Last verified source commit: `7a42e93e4d4c0897c7b1d2c968363522f741861a` on `codex/2.0.6-stabilize` (chat-surface and icon work, 2026-09-16)
- Last verified distribution commit: `0a7dd4d8812ba3d688d3e9ad26915a40f27f00db` on `main`
- Last verified release tag: `2.0.4` (stable) and `2.0.6` (pre-release)

## Reservations

| Task | Agent | Branch | Version reservation | Status | Handoff |
| --- | --- | --- | --- | --- | --- |
| Coordination framework bootstrap | `codex` | `codex/osyc-1.0.67-sync-entry` | None | Complete | `docs/handoff/2026-09-11-coordination-bootstrap.md` |
| OsyC title-font scope fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.76` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-title-font-scope-fix.md` |
| OsyC OC brand and entitlement copy | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.77` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-oc-brand-and-entitlement-copy.md` |
| OsyC sync/font/theme rendering fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.78` | Published test pre-release; backend deployment and mobile validation pending | `docs/handoff/2026-09-12-sync-font-theme-fix.md` |
| OsyC native settings page and account UI | `codex` | `codex/2.0.6-stabilize` | `2.0.6` (consumed by the pre-release) | Published as GitHub pre-release `2.0.6`; UI validation confirmed by the maintainer 2026-09-16; stable promotion still gated on the backend launch baseline | `docs/handoff/2026-09-16-osyc-native-settings-page.md` |
| OsyC chat surface (ChatGPT layout) and icon unification | `codex` | `codex/2.0.6-stabilize` | `None` — needs a new patch reservation (the `2.0.6` tag is immutable) | Code, tests and fingerprints committed at `7a42e93`; unpushed and unpublished, awaiting a version number | `docs/handoff/2026-09-16-osyc-chatgpt-layout-and-icon-unification.md` |

Rules:

- The release captain owns stable reservations. The owning feature agent may create or update its own test-package reservation when the candidate is explicitly marked `test-package` and must publish it as an immutable pre-release.
- `None` means that the work must not change release metadata.
- A version reservation is unique. A second agent must use the existing task record or a different, unreserved version.
- Mark a row `Complete` only after its handoff record includes tests and known gaps.

## Open integration questions

- Name the maintainer who will own the release-captain role.
- ~~Decide whether the next release is a stable patch or a BRAT pre-release after the current mobile review.~~ Decided 2026-09-16: the next release is the `2.0.6` BRAT pre-release, now published. The follow-up decision is whether `2.0.6` is promoted to stable once mobile UI validation passes, or superseded by a patch.
- ~~Is the `2.0.6` pre-release validated?~~ Answered 2026-09-16: the maintainer reported the UI validation as passed. The chat-surface and icon work that followed is committed at `7a42e93` and is **newer than the `2.0.6` pre-release**, so it cannot ship under that version.
- Reserved version for the chat-surface / icon work: **none yet**. Pick the next patch (for example `2.0.7`) before rebuilding assets and pushing `main`; the `2.0.6` tag must stay at `0a7dd4d`.
- Keep the current `2.0.4` Release immutable while those decisions are made.
- Decide whether the unusable `2.0.5` tag should get a GitHub Release retroactively or be documented as a dead tag; it is currently the only rollback gap.
