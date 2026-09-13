# Formal server runtime contract compatibility

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/coordination/README.md` and the runtime fingerprint gate in `src/osyc/features/AIAgent/CmdAIAgent.ts`
- **Version reservation**: `None`
- **Status**: `ready for integration`

## Intent

Restore the runtime fingerprint endpoint required by the immutable OsyC 1.0.75 plugin and prevent deployment-source drift from presenting a healthy but incompatible service. The patch preserves the production snapshot's existing Hermes, regression, LiveSync, billing, and CouchDB integration.

## Files changed

- `work/osyc-backend-src-current/app/main.py`: adds read-only `/api/runtime-info` and maps the deployed snapshot's existing runtime setting names to the canonical client contract.

## Behaviour and compatibility

- The endpoint returns only `backend_release_id`, `hermes_adapter_version`, `artifact_intent_policy_version`, `streaming_protocol_version`, and `plugin_compatibility`.
- Existing `/health`, `/api/send`, `/api/status`, `/api/sync/handshake`, regression, Hermes, and sync routes are unchanged.
- No plugin version, release tag, BRAT asset, or release ledger entry was changed.
- The previous server target remains available at `/srv/osyc/releases/20260911-regression02` through a rollback symlink.

## Verification

```text
python -m py_compile work/osyc-backend-src-current/app/main.py
$env:PYTHONPATH=(Resolve-Path work/osyc-backend-src-current); python -c "from app.main import app; print(any(getattr(r,'path','') == '/api/runtime-info' for r in app.routes))"
curl.exe -sS https://osyctest.sacu3.cn/health
curl.exe -sS https://osyctest.sacu3.cn/api/runtime-info
```

- Result: local import/compile passed; external health and runtime fingerprint returned HTTP 200. The server reports `plugin_compatibility >=1.0.75 <1.1.0`.
- Device or environment: OsyC server `106.55.1.124`, public Tunnel `osyctest.sacu3.cn`.

## Known gaps

- The production release tree still contains pre-existing broad write permissions; that is a separate P0 hardening task and was intentionally not mixed into this compatibility repair.
- Hermes and Tunnel were not restarted; API alone was restarted and its `NRestarts` remained zero after startup.

## Integration request

Integration agent should record this as the authoritative deployment-source correction and keep plugin 1.0.75 immutable. Release captain is not requested to reserve or publish a version.
