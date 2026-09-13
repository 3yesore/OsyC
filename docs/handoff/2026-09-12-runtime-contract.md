# OsyC runtime contract handoff

- **From**: `codex`
- **To**: `integration-agent`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry @ 2a6e3738` (documentation record is append-only; server deployment is recorded below)
- **Change record**: `docs/changes/codex-2026-09-12-runtime-contract.md`
- **Version reservation**: `None`

## Completed

- Added `/api/runtime-info` to the actual deployment source while preserving its existing regression and RunnerSync routes.
- Deployed `/srv/osyc/releases/20260912-runtime-contract01` on `106.55.1.124` and switched `/srv/osyc/current` atomically.
- Kept rollback target `/srv/osyc/releases/rollback-20260912-runtime-contract01` pointing at `20260911-regression02`.
- Restarted only `osyc-api.service`; Hermes, Tunnel, and CouchDB were not restarted.

## Verification evidence

```text
106.55.1.124: /health -> 200 {"ok":true,"backend":"hermes"}
106.55.1.124: /api/runtime-info -> 200
https://osyctest.sacu3.cn/api/runtime-info -> 200
runtime fingerprint: osyc-backend-20260911-regression02 / adapter 2 / artifact policy 1 / stream 1 / plugin >=1.0.75 <1.1.0
osyc-api.service: active, NRestarts=0
```

## Remaining work

- Perform a plugin-side refresh of runtime info and verify the 1.0.75 client no longer reports a version gate failure.
- Schedule the separate filesystem permission hardening review before enabling unrestricted real-model regression.

## Do not change

- Published plugin tag/release `1.0.75` and distribution commit `a1f1085`.
- Hermes, Tunnel, CouchDB services or the 2c2g/140.143.157.44 test environments.

## Integration notes

- The server's environment retains legacy names (`RUNTIME_RELEASE_ID`, `ARTIFACT_POLICY_VERSION`); the API maps them to the canonical plugin response fields. Future backend releases should keep this aliasing or migrate the env file and verify both paths.
