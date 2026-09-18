# Change Record: 发布/更新流程全面更正（目录只认正式发布）

- **Agent**: `codex` (dsh session)
- **Date**: `2026-09-17`
- **Branch**: `codex-2.0.6-stabilize`
- **Related design**: `docs/releases/README.md`, `docs/coordination/README.md`, `docs/changes/codex-2026-09-17-directory-release-channel-guard.md`
- **Version reservation**: none (documentation only)
- **Status**: `applied`

## Intent

After the 2026-09-17 de-listing, correct every important document so that the recorded
release and update procedure matches how the Obsidian Community directory actually
works. The previous documents still described a BRAT-era "publish a pre-release, then
promote it" lane, which is exactly what caused the incident: a version whose only
release was a pre-release while the default-branch manifest already named it.

## What the documents now say

- A release version is published **once, directly as a published release**
  (`prerelease: false`). There is no pre-release stage and no promotion step.
- The default-branch `manifest.json` must always name a version that has a published
  release; the directory removes the plug-in otherwise.
- A candidate that genuinely must stay pre-release keeps its number in
  `manifest-beta.json` only and is published from a feature branch.
- `publish-release-assets.yml` refuses a pre-release from the default branch, and
  `verify-release-channel.yml` checks the invariant hourly.
- The BRAT pre-release/test-package lane is retired.

## Files changed

- `docs/releases/README.md`: the opening paragraph, the required evidence, the trigger
  description, the asset-naming note, and the *Release sequence*, which is rewritten as
  the eight-step published-release flow. The *Directory contract* section records the
  incident.
- `docs/coordination/README.md`: the distribution-repository role, the required flow
  (new step 8), the channel guardrails, and the source-of-truth map.
- `docs/coordination/active-work.md`: the current baseline is corrected to `2.0.10`,
  and the open questions record the resolved channel decision and the retired lane.
- This record.

## Verification

- Documentation only. No plug-in source, asset, version, tag or release changed.
- `node utils/verify-osyc-release.mjs` and `node utils/verify-osyc-collaboration.mjs`
  both exit 0 after the edit.

## Known gaps

- Historical records (`docs/changes/codex-2026-09-1*.md`, `docs/releases/osyc-2.0.5-runbook.md`,
  `docs/releases/osyc-2.0.6-launch-baseline.md`, `docs/releases/legacy.md`) still describe
  the BRAT lane. They are append-only evidence of what was done at the time and are
  deliberately not rewritten.
- The directory's automated review still reports `Caution` for inline styles in
  `main.js`; it does not block the listing.
