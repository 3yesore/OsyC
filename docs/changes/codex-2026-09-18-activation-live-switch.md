# Change Record: 激活流程打开 LiveSync 总开关

- **Agent**: `codex`（WorkBuddy 会话在途完成；Agent D 合并入发布线）
- **Date**: `2026-09-18`
- **Branch**: `codex-2.0.6-stabilize`
- **Related**: `docs/changes/codex-2026-09-18-sync-activation-repair.md`（同一故障的另一半：加载时自愈）
- **Version reservation**: cut into `2.0.11`
- **Status**: `merged into the 2.0.11 cut`

## Intent

A freshly activated device must start uploading the Vault immediately. Before this change it did not: the tenant database kept only `obsydian_livesync_version` and the server-side vault stayed empty.

## Root cause

`buildSetupPatch()` merged the backend setup URI into the LiveSync settings as-is. That payload carries only identity keys plus `isConfigured`/`usePluginSyncV2`/`configPassphraseStore`/`encrypted*` — it has no `liveSync`, and the LiveSync default is `false`. The replicator starts on `liveSync || syncOnStart` (`ModuleReplicatorCouchDB._everyAfterResumeProcess`), so it never opened.

## Files changed

- `src/osyc/features/AIAgent/livesyncPatch.ts`: `buildSetupPatch()` now returns `liveSync: true` unconditionally, after the decoded identity keys. The switch is set here rather than in the payload because the payload is encoded by commonlib, and because the semantics of activation are "start syncing" even if a future payload says otherwise.
- `src/osyc/features/AIAgent/livesyncPatch.unit.spec.ts`: rewritten around that invariant (a case asserts that a payload carrying `liveSync: false` is still overridden).

## Verification

`vitest run --config vitest.config.unit.ts src` and the release contract checks are run again as part of the 2.0.11 cut; the results are recorded in `release-info.json` and the release ledger.

## Known gaps

- This half only repairs activations that happen after the build is installed. Devices already activated against the broken configuration are repaired by the load-time half in `codex-2026-09-18-sync-activation-repair.md`.
- Real-device acceptance is still pending: the proof is a tenant database whose `doc_count` grows past the version marker.
