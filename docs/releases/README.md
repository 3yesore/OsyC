# OsyC Release Governance

OsyC releases are published to `3yesore/OsyC` for BRAT installation. The source repository and the distribution repository are separate, so a release is valid only when their reviewed commits and five assets agree.

The current 2.0.6 service and plug-in launch state is recorded in [`osyc-2.0.6-launch-baseline.md`](osyc-2.0.6-launch-baseline.md). It is evidence only; the release ledger remains the publication authority.

## Single release authority

Read `release-ledger.json` before preparing any release. It is the only publication ledger. The release captain is the only role allowed to edit its release state, reserve a version, create a tag, or publish a GitHub Release.

## Required release evidence

- exact reviewed source commit and distribution commit;
- exact SemVer tag, with no tag movement or force-push;
- aligned `package.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, `main.js`, and `styles.css`;
- five BRAT assets with SHA-256 evidence;
- GitHub Release state (`draft`, `prerelease`, or stable);
- BRAT mobile validation status and known gaps.

## Release sequence

1. Feature agents submit change records and update `## Unreleased` only for user-facing changes.
2. The release captain reserves one version in `active-work.md` and prepares the release from one reviewed commit.
3. Run the existing release contract check and `utils/verify-osyc-collaboration.mjs`.
4. Publish the exact tag as a GitHub pre-release for BRAT validation when mobile review is required.
5. Promote a validated stable release through a separate maintainer action. If validation fails, keep the published tag immutable and prepare the next patch or pre-release.

Documentation-only coordination changes do not enter a BRAT package and do not bump the plug-in version.
