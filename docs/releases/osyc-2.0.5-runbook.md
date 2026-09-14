# OsyC 2.0.5 Maintenance Runbook

This runbook records the repeatable maintenance path for the OsyC plug-in and its Hermes backend. It does not replace the release ledger or the repository release governance.

## Version line

Use a `codex/2.0.5-*` branch for the 2.0.5 maintenance line. Keep the `2.0.4` tag, GitHub Release, and the server backup under `/srv/osyc/backups/20260914-hermes204-pre` unchanged. Do not reuse a published tag.

Before building, align `package.json`, `package-lock.json`, `manifest.json`, `manifest-beta.json`, `versions.json`, and all workspace package versions. Generate `main.js` and the other BRAT assets only after that metadata is aligned. Record the final source commit and asset SHA-256 values in the release evidence.

## Publication order

1. Run the complete plug-in unit suite, type checks, Svelte checks, community lint, compatibility check, and production build.
2. Deploy the backend release first. Save a timestamped copy of the current release and configuration, then atomically switch `/srv/osyc/current`.
3. Restart only `osyc-api.service` and `osyc-hermes-prod.service`. Verify `/health`, `/api/runtime-info`, and a zero-cost dry-run.
4. Create the exact five-asset plug-in release as a GitHub pre-release. Validate desktop and mobile behaviour before promotion.
5. Promote the same immutable release to stable only after BRAT and Community Plugins validation.

The runtime contract must continue to expose `backend_release_id`, `hermes_adapter_version`, `artifact_intent_policy_version`, `streaming_protocol_version`, and `plugin_compatibility`. The 2.0.5 client remains strict about this compatibility gate.

## Acceptance samples

The ordinary dialogue sample 'test' must return only `response_text`, with no new Markdown file. An explicit request to generate a report into a note must create one validated Artifact. During a running task, the client may show visible model output and safe phase events, but it must not display reasoning text, tool arguments, absolute server paths, or terminal output.

## Rollback

If health, runtime-info, dry-run, or BRAT validation fails, leave published tags unchanged. Restore `/srv/osyc/current` from the timestamped backup, restart only the two OsyC services, and repeat the health and runtime checks. Keep 2.0.4 available as the plug-in rollback version.

Never commit server credentials, API keys, card keys, certificates, Vault content, or generated service configuration to this repository or its release assets.
