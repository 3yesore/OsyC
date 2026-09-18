# Change Record: 激活自愈——保证任何卡密/租户都能把 vault 完整上云

- **Agent**: `codex` (dsh session)
- **Date**: `2026-09-18`
- **Branch**: `codex-sync-activation-repair`
- **Related**: `docs/changes/codex-2026-09-17-sync-provisioning-gate.md`；生产故障现场见本仓 `docs/releases/README.md` 之外的运维记录（租户 `37e5e9d0-…`，CouchDB `t_37e5e9d0…` `doc_count=1`）
- **Version reservation**: none (proposed for the next patch)
- **Status**: `verified locally, branch only`

## Intent

Guarantee that a user's Vault actually reaches the cloud — for a new card, an old card, and a tenant created before this fix — instead of the current behaviour where activation succeeds but nothing is uploaded.

## Root cause

The activation flow merges the backend's setup URI into the LiveSync settings, but that payload carries only identity keys plus `isConfigured`/`usePluginSyncV2`/`configPassphraseStore`/`encrypted*`. It has **no `liveSync`**, and the LiveSync default is `false`. The replicator starts on `liveSync || syncOnStart` (ModuleReplicatorCouchDB._everyAfterResumeProcess); with both false it never opens.

Production evidence (2026-09-18): the tenant `37e5e9d0-a57b-47b7-94a6-d08a74f75979` for card `3YESORE-CENTCOLYS` has a healthy chain (card → tenant → per-tenant runner config → CouchDB database and account → provisioning ready), the runner pulls and pushes successfully, and yet the database holds exactly one document — `obsydian_livesync_version` — so the server-side vault stays empty and the agent answers "the vault is empty".

## What this change adds

- `src/osyc/features/AIAgent/livesyncActivation.ts` (new): `planProvisionedReplicationRepair()` returns `{ liveSync: true }` only when the settings were provisioned by the OsyC activation flow and the user has no other remote:
  1. `isConfigured === true`;
  2. `liveSync` is not already true;
  3. an `osyc` remote configuration exists (only the activation flow writes that id);
  4. the active configuration is not another remote, and no other remote configuration exists.
- `src/osyc/serviceFeatures/useAIAgentUI.ts`: at plugin load, apply that repair once (`applyPartial({liveSync:true}, true)` + `control.applySettings()`) and log it. This repairs devices that were activated before the fix, without asking the user to re-enter the card.
- `src/osyc/features/AIAgent/livesyncActivation.unit.spec.ts` (new): 7 cases covering the repair decision and every safety-valve branch.

## Relationship to the other half

The activation-time fix belongs in `buildSetupPatch()` (`liveSync: true` on the patch built from the setup URI). That edit exists uncommitted in the `osyc-review-cleanup` worktree at the time of writing and is deliberately **not** duplicated here, to keep one source of truth per file. Together they cover both directions:

- activation time → a brand-new activation starts uploading immediately;
- load time (this record) → an already-activated device repairs itself on the next start.

If only this half ships, a fresh activation still uploads, but not until the next plugin load.

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc/features/AIAgent/livesyncActivation.unit.spec.ts
npm run tsc-check
```

- `vitest`: **1 file / 7 tests passed**.
- `tsc --noEmit`: exit 0.

## Known gaps

- No end-to-end device test: the proof that the Vault reaches the cloud is a non-empty `doc_count` on the tenant database after a device run.
- The other half (`buildSetupPatch`) is still uncommitted elsewhere; both must land for the guarantee to hold end to end.
- The repair runs once per plugin load. It does not retry if the first upload fails for a network reason beyond LiveSync's own retries.
