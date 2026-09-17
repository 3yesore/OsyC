# Change Record: 目录发布通道守卫（默认分支 manifest 必须有正式 Release）

- **Agent**: `codex` (dsh session)
- **Date**: `2026-09-17`
- **Branch**: `codex-release-channel-guard`
- **Related design**: `docs/releases/README.md`, `docs/changes/codex-2026-09-17-settings-modal-and-osyc-group-first.md`
- **Version reservation**: none (workflow and documentation only; no plug-in version change)
- **Status**: `ready for review, not merged to main`

## Intent

Stop the Obsidian Community directory from de-listing `osyc` again through a
manifest/release mismatch. The incident is recorded in
`outputs/事故-2026-09-17-插件被目录下架-根因与修复.md` on the operator machine.

## Root cause

`publish-release-assets.yml` created a **pre-release** for a push to `main`
(`prerelease: requestedPrerelease ?? true`). The directory reads
`manifest.json` at the default branch HEAD and matches only a **published**
release. On 2026-09-17:

- 06:03Z `c4c6efd` set `main`'s manifest to `2.0.9`;
- 06:04Z the workflow created release `2.0.9` as a pre-release;
- 06:43Z the directory mirror `b6b66a2c` dropped `osyc` from
  `community-plugins.json` because no published release matched `2.0.9`;
- 11:12Z the release was promoted, but the mirror entry stays removed until the
  directory re-publishes it.

## Files changed

- `.github/workflows/publish-release-assets.yml`: a push now creates a
  published release (`prerelease: false`); the job refuses to create a
  pre-release from the default branch, before any release or asset is touched;
  the manual dispatch input defaults to `false`.
- `.github/workflows/verify-release-channel.yml` (new): hourly and manual check
  that `manifest.json` on `main` has a matching published release.
- `docs/releases/README.md`: documents the directory contract and the incident.

## Verification

- Both workflow files parse as YAML (`js-yaml`).
- Both embedded `github-script` bodies pass `node --check` when wrapped as an
  async function (the shape `actions/github-script` executes).
- Not verified: a live workflow run. This branch is deliberately **not** pushed
  to `main`, because a push to `main` re-runs the asset upload, and that
  workflow deletes the existing assets before uploading them. Landing it while
  the directory is still restoring the `2.0.9` listing risks a worse outcome.

## Known gaps

- The directory re-publish itself is outside this repository; the listing
  returns when the directory re-scans the now-valid `2.0.9`, or after a manual
  re-submission at https://community.obsidian.md.
- `release.yml` and `finalise-release.yml` were not examined for the same
  pre-release assumption.

## Integration request

Merge this branch to `main` together with the next version cut, when the asset
refresh is the expected action anyway. Do not merge it while `2.0.9` assets are
mid-recovery.
