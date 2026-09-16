# OsyC Agent Collaboration

This directory defines the coordination contract for agents working on OsyC. It supplements, and does not replace, the repository contribution and release rules.

## Repository roles

- **Source repository**: this `obsidian-livesync` checkout. It owns source code, tests, design records, and release preparation.
- **Distribution repository**: `3yesore/OsyC`. It owns the five BRAT files and GitHub Releases.
- **Feature agent**: implements a bounded change, writes an append-only change record, and provides verification evidence. A feature agent may publish a reserved, immutable test-package version through the test lane; it may not promote a release to stable.
- **Integration agent**: reviews compatible feature records, resolves conflicts, and updates formal design or construction documents.
- **Release captain**: the sole writer of stable-release state and the sole operator allowed to promote a release to stable. The captain may also publish test packages when acting as the release owner.

The release captain role is currently represented by the stable identifier `release-captain`. Replace it with a named maintainer when one is appointed.

## Required flow

1. Read `active-work.md`, the release ledger, and the relevant design documents before starting.
2. Fetch tags and remote refs before comparing or preparing release state:
   `git fetch origin --tags` and `git fetch osyc-distribution --tags`.
3. Work on a task branch named `codex/osyc/<task-name>`.
4. Record implementation notes in `docs/changes/<agent>-<yyyy-mm-dd>-<slug>.md`. Records are append-only; corrections are new records.
5. Record the handoff in `docs/handoff/` using `agent-handoff-template.md`.
6. Ask the integration agent to merge design proposals into `docs/design/` and construction plans. Agents must not silently rewrite another agent's formal document.
7. For a mobile test package, the owning agent reserves the version in `active-work.md`, performs metadata alignment and build verification, then publishes an immutable GitHub pre-release from the exact five-asset package. Stable promotion remains a release-captain action.

## Version and release guardrails

- `docs/releases/release-ledger.json` is the single publication authority. It records the current stable release, the previous stable release, any reserved candidate (including whether that candidate has been published as a pre-release), the canonical source and distribution commits, and the five versioned repository assets. See `docs/releases/README.md` for the difference between repository assets and the three files actually uploaded to a GitHub Release.
- Stable release fields remain release-captain-only. A feature agent may update the candidate reservation and test-package evidence for its own reserved version; it must not edit `currentStable` or any published release entry.
- Every release version is reserved once. Never reuse a version, move an existing tag, or force-push a tag.
- A release is immutable after publication. Corrections use the next patch or pre-release version.
- Before publication, `package.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, `main.js`, and `styles.css` must be generated from the same reviewed source state.
- A stable release staged for BRAT is a GitHub pre-release until mobile validation passes. Promotion to stable is a separate maintainer action.
- Test-package lane: the version must be reserved, SemVer-unique, published as a GitHub pre-release, and built from exactly one source state. The lane may not move or overwrite stable tags, and mobile validation status must remain explicitly pending until the user confirms it.
- Documentation-only coordination changes do not bump the plug-in version or create a BRAT package.

## Conflict policy

- Separate independent work by file whenever practical. Use one record per agent and task.
- If two agents touch the same formal design document, each writes a proposal first. The integration agent merges the proposals and records the decision.
- If release metadata conflicts with the ledger, stop publication and reconcile against the immutable tag and Release evidence. Do not choose the newest local checkout by guesswork.
- Preserve existing published versions. Never reset, checkout over, or discard another agent's work without explicit authorisation.

## Source of truth map

| Concern | Authoritative location | Writer |
| --- | --- | --- |
| Formal product design | `docs/design/` | Integration agent |
| Active reservations and handoffs | `docs/coordination/active-work.md` | Integration or release captain |
| Agent work evidence | `docs/changes/` | Contributing agent |
| Handoff evidence | `docs/handoff/` | Contributing agent |
| Published release state | `docs/releases/release-ledger.json` | Release captain |
| Release procedure | `docs/releases/README.md` | Maintainer |

## Before starting work

Confirm the current version and branch, inspect the active-work register, and check for uncommitted changes. If a task is already reserved, continue it through the recorded handoff rather than opening a second implementation line.
