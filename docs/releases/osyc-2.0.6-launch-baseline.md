# OsyC 2.0.6 Launch Baseline

This document is a read-only launch baseline for the OsyC 2.0.6 candidate. It records the state observed on 15 September 2026 and does not authorise deployment or stable publication.

## Version state

| Area | Observed state | Decision |
| --- | --- | --- |
| Plug-in branch | `codex/2.0.6-stabilize` | Keep as the single maintenance line |
| Plug-in candidate | `2.0.6`, channel `prerelease-candidate` | Do not promote before desktop and mobile acceptance |
| Candidate source | `4dbb2ff` (fingerprint metadata), assets built from `4833ad3` | Keep immutable while backend work is synchronised |
| Previous plug-in baseline | `2.0.5` tag | Preserve for rollback; do not move or overwrite |
| Production backend | `osyc-backend-20260915-stable205` | Treat as the current service baseline |
| Production Hermes | `hermes-oc-adapter-prod-20260915` | Keep unchanged until the 2.0.6 backend candidate is verified |

## Plug-in evidence

The five release assets in `release-info.json` match their local SHA-256 values. The candidate has passed:

- `npm run test:unit`: 957 passed;
- `npm run check`: TypeScript, application type checks, lint with warnings only, community lint, Svelte check, production build, and iOS 15 compatibility;
- focused Agent, Mock, tools-centre, streaming, Artifact, announcement, and diagnostics tests.

At the time of inspection, the source working tree was clean. The branch was eight commits ahead of `origin/codex/2.0.6-stabilize` and had not been pushed or published from this baseline.

## Production evidence

The read-only server check found both `osyc-api.service` and `osyc-hermes-prod.service` active. The API health response was successful, and `/api/runtime-info` reported:

```json
{
  "backend_release_id": "osyc-backend-20260915-stable205",
  "hermes_adapter_version": "2",
  "artifact_intent_policy_version": "1",
  "streaming_protocol_version": "1",
  "plugin_compatibility": ">=2.0.3 <2.1.0"
}
```

Compared with `20260914-hermes204`, the deployed API source differs only in the runtime release identifier and execution-mode validation. No 2.0.6 backend source was present in the inspected release or staging directories. The planned endpoints `/api/error-reports` and `/api/auth/email/request-code` currently return `404`; this is an explicit launch blocker.

The preserved rollback directory is `20260915-stable205-pre`. A future deployment may restart only `osyc-api.service` and `osyc-hermes-prod.service`, after a new timestamped backup and successful health, runtime-info, and dry-run checks.

## Known validation gap

`scripts/smoke_llm.py` executes immediately and has no `--help` parser. It uses an isolated TestClient and stub model, but its current artifact assertion fails. It must not be used as the release dry-run until the script is repaired or replaced by a documented zero-cost check. The isolated `SMOKE001` fixture data was left untouched.

## Launch gates

Do not deploy or publish stable 2.0.6 until all of the following are true:

1. The synchronised backend candidate exists in a versioned release directory with a new runtime release ID and the diagnostics/email contracts.
2. Backend compile and focused/full tests pass in an environment containing its declared dependencies.
3. Health, runtime-info, and a zero-cost dry-run pass without changing production data or charging credits.
4. Four low-cost acceptance samples pass: ordinary test, sync-status explanation, explicit report delivery, and confirmed diagnostic upload.
5. Desktop and mobile UI acceptance confirms the tools centre, no-config failure state, streaming phases, and Artifact policy.
6. The exact five plug-in assets are rebuilt from the reviewed source state and re-hashed before a prerelease is staged.

Until then, retain `2.0.5` and the server backup as the rollback path and leave the Community Plugins stable channel unchanged.
