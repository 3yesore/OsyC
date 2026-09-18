# OsyC Active Work Register

This register prevents two agents from implementing or publishing the same line of work. It is a coordination record, not a substitute for the append-only change records in `docs/changes/`.

## Current baseline (corrected 2026-09-17)

- Current stable plug-in: **`2.0.10`** (published 2026-09-17T12:18:22Z as a **published** release; source commit `9b2af60`, published from `fdbfdec`; the three release assets matched `release-info.json` byte for byte).
- Previous stable: `2.0.9` (published 2026-09-17T06:04:59Z, promoted 11:12Z). `2.0.8`, `2.0.7` and `2.0.6` are pre-releases of the retired BRAT era; `2.0.5` has a tag but no GitHub Release; `2.0.4` is the last pre-2.0.6 non-prerelease release.
- Distribution repository: `3yesore/OsyC`
- Release ledger: `docs/releases/release-ledger.json` (updated 2026-09-17 with the `2.0.10` publication)
- Last verified source commit: `80aadec` on `codex-2.0.6-stabilize` (flat branch name; the nested `codex/2.0.6-stabilize` ref is kept as an archive because nested refs are unreliable on this machine)
- Last verified distribution commit: `80aadec` on `main`
- Last verified release tag: `2.0.10`
- ⚠️ **Channel rule (2026-09-17 incident).** The Obsidian Community directory matches **published** releases only. `2.0.9` was created as a pre-release while the default-branch manifest already named it, so the directory scan at 06:43Z found no matching published release and removed the listing. Releases are now published directly: `publish-release-assets.yml` refuses to create a pre-release from the default branch, and `verify-release-channel.yml` checks the invariant hourly. See `docs/releases/README.md` → *Directory contract*.

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
- ~~Which channel?~~ Resolved 2026-09-17: **published releases only**, no pre-release stage and no promotion step. The BRAT pre-release lane is retired because the Community directory matches published releases only and a pre-release for the default-branch version de-lists the plug-in.
- ~~`GET /releases/latest` returned `2.0.0`.~~ Resolved: it now resolves to `2.0.10`. The 2026-09-16 note described the community-directory listing rather than what an installed client receives; Obsidian takes the version from the default-branch `manifest.json` and downloads the assets of the release whose tag matches it.
- ~~Should `2.0.5` get a Release retroactively?~~ No. It stays a dead tag and is documented as such; the effective rollback target is the previous published release in the ledger.
- Retired: the pre-release/test-package lane. A candidate that must stay unreleased keeps its number in `manifest-beta.json` only and is published from a feature branch.
- Open: the directory's automated review still reports **Caution** for `main.js` (inline `:has` and `!important` usage). It does not block the listing, but it should be reduced.
