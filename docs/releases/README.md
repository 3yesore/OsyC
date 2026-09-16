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

## How a publication is actually triggered

The plug-in is published by the repository's own automation, not by a local `gh` command:

- `.github/workflows/publish-release-assets.yml` runs on **every push to `main`**.
- It reads `manifest.json` at the pushed commit, creates or refreshes the GitHub Release for that version, and uploads `main.js`, `manifest.json`, and `styles.css` **from that same commit**.
- On a push event a newly created Release defaults to **pre-release**. A later ordinary push refreshes the assets without changing the channel of an existing stable Release, so a stable release is never silently demoted.
- A plain fast-forward push of `main` to the reviewed commit is therefore the publication action, and `main` always points at the published commit. This is how `2.0.4` (stable) and `2.0.6` (pre-release) were published.
- `release.yml` and `finalise-release.yml` are a stricter, tag-first alternative. `finalise-release.yml` pushes `refs/tags/<version>` and `refs/tags/<version>-cli` atomically, and no `-cli` tag has ever been created in this repository, so that path would fail at its own tag push. Do not treat it as the working procedure without first creating the CLI tag.

The version's own tag (`2.0.6` for version `2.0.6`) is created by that workflow and must never be moved afterwards.

## Asset naming

Two different sets are both called "assets" in these documents, and conflating them has caused confusion:

- **Repository assets** — `main.js`, `manifest.json`, `manifest-beta.json`, `styles.css`, `versions.json`. These are versioned files that must stay aligned and are hashed in `release-info.json`. `utils/verify-osyc-collaboration.mjs` exports this exact list as `BRAT_ASSETS`, which is why the ledger's `currentStable.assets` contains all five.
- **Release assets** — `main.js`, `manifest.json`, `styles.css`. These are what the workflow uploads and what BRAT actually downloads; `manifest-beta.json` and `versions.json` are read from the repository tree.

## Release sequence

1. Feature agents submit change records and update `## Unreleased` only for user-facing changes.
2. The release captain reserves one version in `active-work.md` and prepares the release from one reviewed commit.
3. Run the existing release contract check and `utils/verify-osyc-collaboration.mjs`.
4. Publish the exact tag as a GitHub pre-release for BRAT validation when mobile review is required.
5. Promote a validated stable release through a separate maintainer action. If validation fails, keep the published tag immutable and prepare the next patch or pre-release.

Documentation-only coordination changes do not enter a BRAT package and do not bump the plug-in version.
