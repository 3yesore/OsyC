# OsyC Active Work Register

This register prevents two agents from implementing or publishing the same line of work. It is a coordination record, not a substitute for the append-only change records in `docs/changes/`.

## Current baseline

- Current stable plug-in: `2.0.4` (published 2026-09-14). `2.0.5` has a tag but no GitHub Release, so it is not a BRAT-installable rollback target.
- Current pre-release: `2.0.7` (published 2026-09-16 as a GitHub pre-release for BRAT mobile validation; not a stable promotion). It carries the chat-surface (ChatGPT layout) and icon-unification work.
- Previous pre-release: `2.0.6` (tag stays at `0a7dd4d`; never move it).
- Distribution repository: `3yesore/OsyC`
- Release ledger: `docs/releases/release-ledger.json` (updated 2026-09-16 with the `2.0.6` pre-release)
- Last verified source commit: `1fc9006471ba4afc7d2e975b4cf5b5ec7fefde4e` on `codex-2.0.6-stabilize` (flat branch name; the nested `codex/2.0.6-stabilize` ref is kept as an archive because nested refs are unreliable on this machine)
- Last verified distribution commit: `1fc9006471ba4afc7d2e975b4cf5b5ec7fefde4e` on `main`
- Last verified release tag: `2.0.7` (pre-release), `2.0.6` (pre-release), and `2.0.4` (newest non-prerelease release)

## Reservations

| Task | Agent | Branch | Version reservation | Status | Handoff |
| --- | --- | --- | --- | --- | --- |
| Coordination framework bootstrap | `codex` | `codex/osyc-1.0.67-sync-entry` | None | Complete | `docs/handoff/2026-09-11-coordination-bootstrap.md` |
| OsyC title-font scope fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.76` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-title-font-scope-fix.md` |
| OsyC OC brand and entitlement copy | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.77` | Published test pre-release; awaiting mobile validation | `docs/handoff/2026-09-12-oc-brand-and-entitlement-copy.md` |
| OsyC sync/font/theme rendering fix | `codex` | `codex/osyc-1.0.67-sync-entry` | `1.0.78` | Published test pre-release; backend deployment and mobile validation pending | `docs/handoff/2026-09-12-sync-font-theme-fix.md` |
| OsyC native settings page and account UI | `codex` | `codex/2.0.6-stabilize` | `2.0.6` (consumed by the pre-release) | Published as GitHub pre-release `2.0.6`; UI validation confirmed by the maintainer 2026-09-16; stable promotion still gated on the backend launch baseline | `docs/handoff/2026-09-16-osyc-native-settings-page.md` |
| OsyC chat surface (ChatGPT layout) and icon unification | `codex` | `codex/2.0.6-stabilize` | `2.0.7` (maintainer-authorised preview, 2026-09-16) | **Published as GitHub pre-release `2.0.7`** (tag @ `1fc9006`, 2026-09-16T11:30:00Z); BRAT validation pending | `docs/handoff/2026-09-16-osyc-chatgpt-layout-and-icon-unification.md` |

Rules:

- The release captain owns stable reservations. The owning feature agent may create or update its own test-package reservation when the candidate is explicitly marked `test-package` and must publish it as an immutable pre-release.
- `None` means that the work must not change release metadata.
- A version reservation is unique. A second agent must use the existing task record or a different, unreserved version.
- Mark a row `Complete` only after its handoff record includes tests and known gaps.

## Open integration questions

- Name the maintainer who will own the release-captain role.
- ~~Decide whether the next release is a stable patch or a BRAT pre-release after the current mobile review.~~ Decided 2026-09-16: the next release is the `2.0.6` BRAT pre-release, now published. The follow-up decision is whether `2.0.6` is promoted to stable once mobile UI validation passes, or superseded by a patch.
- ~~Is the `2.0.6` pre-release validated?~~ Answered 2026-09-16: the maintainer reported the UI validation as passed. The chat-surface and icon work that followed is committed at `7a42e93` and is **newer than the `2.0.6` pre-release**, so it cannot ship under that version.
- Reserved version for the chat-surface / icon work: **`2.0.7`**, authorised by the maintainer on 2026-09-16 and published the same day. The `2.0.6` tag must stay at `0a7dd4d`.
- ⚠️ **The "stable rollback = 2.0.4" claim does not hold on the GitHub side.** `GET /releases/latest` returns `2.0.0` even though `2.0.4` (2026-09-14) is newer and is not a prerelease, so a BRAT stable (non-beta) install may resolve to `2.0.0`. Observed twice on 2026-09-16 while verifying the `2.0.7` publication. Confirm on a real device, then re-point latest to `2.0.4` (needs a credential; release-captain action) or install by explicit version.
- Keep the current `2.0.4` Release immutable while those decisions are made.
- Decide whether the unusable `2.0.5` tag should get a GitHub Release retroactively or be documented as a dead tag; it is currently the only rollback gap.
