# OsyC Release Governance

OsyC releases are published to `3yesore/OsyC` for the Obsidian Community directory (`community.obsidian.md`), and the same release assets remain installable through BRAT. The source repository and the distribution repository are separate, so a release is valid only when their reviewed commits and the five versioned files agree.

The current 2.0.6 service and plug-in launch state is recorded in [`osyc-2.0.6-launch-baseline.md`](osyc-2.0.6-launch-baseline.md). It is evidence only; the release ledger remains the publication authority.

## Single release authority

Read `release-ledger.json` before preparing any release. It is the only publication ledger. The release captain is the only role allowed to edit its release state, reserve a version, create a tag, or publish a GitHub Release.

## Required release evidence

- exact reviewed source commit and distribution commit;
- exact SemVer tag, with no tag movement or force-push;
- aligned `package.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, `main.js`, and `styles.css`;
- the five versioned files with SHA-256 evidence (`release-info.json`);
- GitHub Release state: **`published` (non-prerelease) is required for the default-branch version**, because the Obsidian Community directory matches published releases only;
- device acceptance status and known gaps.

## How a publication is actually triggered

The plug-in is published by the repository's own automation, not by a local `gh` command:

- `.github/workflows/publish-release-assets.yml` runs on **every push to `main`**.
- It reads `manifest.json` at the pushed commit, creates or refreshes the GitHub Release for that version, and uploads `main.js`, `manifest.json`, and `styles.css` **from that same commit**.
- On a push event a newly created Release is a **published release** (`prerelease: false`). A later ordinary push refreshes the assets without changing the channel of an existing release, so a release is never silently demoted. Creating a pre-release for the default branch's manifest version is refused outright; see *Directory contract* below.
- A plain fast-forward push of `main` to the reviewed commit is therefore the publication action, and `main` always points at the published commit. `2.0.10` was the first release published under the guard; `2.0.4`, `2.0.6`, `2.0.7`, `2.0.8` and `2.0.9` predate it (the pre-release ones are the reason the guard exists).
- `release.yml` and `finalise-release.yml` are a stricter, tag-first alternative. `finalise-release.yml` pushes `refs/tags/<version>` and `refs/tags/<version>-cli` atomically, and no `-cli` tag has ever been created in this repository, so that path would fail at its own tag push. Do not treat it as the working procedure without first creating the CLI tag.

The version's own tag (`2.0.6` for version `2.0.6`) is created by that workflow and must never be moved afterwards.

## Directory contract (Obsidian Community directory)

The Obsidian Community directory reads `manifest.json` at the **default branch HEAD** and matches only a **published** (non-prerelease) GitHub release whose tag equals that version. If the manifest names a version whose only release is a pre-release, the directory removes the plug-in until the release is promoted. This happened on 2026-09-17: `2.0.9` was published as a pre-release at 06:04Z while `main`'s manifest already said `2.0.9`, the directory scan at 06:43Z found no matching published release, and the mirror commit `b6b66a2c` dropped `osyc` from `community-plugins.json`.

Therefore:

- never leave `manifest.json` on `main` pointing at a version whose only release is a pre-release;
- candidates that must stay pre-release keep their version in `manifest-beta.json` and are published from a branch, not from `main`;
- `publish-release-assets.yml` refuses to create a pre-release from the default branch;
- `verify-release-channel.yml` checks the invariant hourly and fails loudly before the directory scanner sees it.

## Asset naming

Two different sets are both called "assets" in these documents, and conflating them has caused confusion:

- **Repository assets** — `main.js`, `manifest.json`, `manifest-beta.json`, `styles.css`, `versions.json`. These are versioned files that must stay aligned and are hashed in `release-info.json`. `utils/verify-osyc-collaboration.mjs` exports this exact list as `BRAT_ASSETS`, which is why the ledger's `currentStable.assets` contains all five.
- **Release assets** — `main.js`, `manifest.json`, `styles.css`. These are what the workflow uploads and what an installing client downloads; `manifest-beta.json` and `versions.json` are read from the repository tree.

## Release sequence (current, since 2.0.10)

A release version is published **once, directly as a published release**. There is no pre-release stage and no promotion step, because the Community directory matches published releases only and a pre-release for the default branch's version de-lists the plug-in.

1. Feature agents submit change records and update `## Unreleased` for user-facing changes.
2. The release captain reserves one version in the release ledger (`candidate`) and prepares from one reviewed commit.
3. Bump `package.json`, `manifest.json`, `manifest-beta.json`, `versions.json` and every workspace package together; rebuild `main.js` from that same source state.
4. Run `npm run tsc-check`, `npm run svelte-check`, the unit suite, `node utils/verify-osyc-release.mjs` and `node utils/verify-osyc-collaboration.mjs`. All must pass.
5. Record the five SHA-256 values in `release-info.json`, then commit the cut and the fingerprint record.
6. Fast-forward `main` to the reviewed commit (`git push origin <sha>:refs/heads/main`). The workflow creates the release as a **published release** and uploads the three assets.
7. Verify: the release is `prerelease=false`, its three assets match `release-info.json` byte for byte, and `GET /releases/latest` resolves to the new version.
8. Update the ledger: `currentStable` becomes the new version; the previous one moves to `previousStable`.

**Never** publish a version as a pre-release while `main`'s `manifest.json` names that version. A candidate that genuinely must stay pre-release keeps its number in `manifest-beta.json` only, is published from a feature branch, and never reaches the default branch until it is published normally. `publish-release-assets.yml` refuses the forbidden combination, and `verify-release-channel.yml` checks the invariant hourly.

Documentation-only coordination changes do not bump the plug-in version and do not create a release.
