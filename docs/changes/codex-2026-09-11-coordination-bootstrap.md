# Change Record: OsyC collaboration framework bootstrap

- **Agent**: `codex`
- **Date**: `2026-09-11`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/coordination/README.md`
- **Version reservation**: `None`
- **Status**: `integrated`

- **Integrated by**: `e665303d` plus the integration commit containing this record

## Intent

Create a shared, auditable workflow for multiple agents maintaining OsyC design records, implementation evidence, handoffs, and BRAT releases. The framework must prevent duplicate version publication and preserve immutable releases.

## Files changed

- `docs/coordination/`: collaboration rules, active-work register, plan, and templates.
- `docs/design/README.md`: formal design-document lifecycle and OsyC entry points.
- `docs/changes/README.md`: append-only change-record rules.
- `docs/handoff/README.md`: handoff evidence rules.
- `docs/releases/README.md`: release ownership and publication sequence.
- `docs/releases/release-ledger.json`: verified `1.0.75` baseline and publication guardrails.
- `utils/verify-osyc-collaboration.mjs`: read-only source and distribution metadata checker.
- `utils/verify-osyc-collaboration.unit.spec.ts`: checker regression tests.

## Behaviour and compatibility

- No plug-in version, tag, Release, server, or BRAT asset was changed.
- Feature agents have no release authority; the release captain is the single release-state writer.
- The checker validates local metadata and optionally a local distribution tree. Git commit checks are opt-in through `--check-refs`.

## Verification

```text
node utils/verify-osyc-collaboration.mjs
node utils/verify-osyc-collaboration.mjs --check-refs
npx vitest run --config vitest.config.unit.ts utils/verify-osyc-collaboration.unit.spec.ts
node -e "JSON.parse(require('fs').readFileSync('docs/releases/release-ledger.json','utf8'))"
git diff --check
```

- Result: all commands passed; focused tests: `5 passed`.
- Device or environment: local Windows source checkout.

## Known gaps

- The named maintainer for `release-captain` is still pending.
- The local distribution checkout is intentionally not treated as remote authority; remote Release and asset evidence remains a maintainer check.

## Integration request

Integrate the documentation and checker as development governance infrastructure. Keep the current `1.0.75` release immutable and do not bump the plug-in version for these files.
