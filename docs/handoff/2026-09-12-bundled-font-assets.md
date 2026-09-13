# OsyC bundled font assets handoff

- **From**: `codex`
- **To**: `integration agent`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry` @ `a81c8ad1` (plus font-mount commits `c774c4b7`, `4c839db9`)
- **Change record**: `docs/changes/codex-2026-09-12-bundled-font-assets.md`
- **Version reservation**: `None`

## Completed

- Embedded Noto Sans SC Simplified Chinese, Inter Latin, and JetBrains Mono Latin WOFF2 subsets into the existing `styles.css` BRAT asset.
- Kept source binaries under `assets/fonts/` and added per-family OFL-1.1 license files and source references.
- Added `utils/embed-osyc-fonts.mjs` so the CSS data block can be regenerated deterministically.
- Added an asset contract test for all bundled families and the `data:font/woff2;base64,` prefix.

## Verification evidence

```text
npx vitest run --config vitest.config.unit.ts src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts
```

Result: `14 passed` after embedding.

## Remaining work

- Re-run full OsyC tests, TypeScript, Svelte, production build, compatibility, and release contract checks after integration.
- On iOS, switch among bundled Noto/Inter/JetBrains stacks and confirm body, headings, code, and preview change without network access.
- Release captain reserves the next version and publishes only from the reviewed commit.

## Do not change

- Do not alter or republish `1.0.75`.
- Do not replace the embedded binaries with remote URLs or unlicensed fonts.
- Do not touch OC/2c2g servers.

## Integration notes

BRAT's normal five-file installation path includes `styles.css`, so no new release asset type is required. The generated block is marked by a stable comment and can be regenerated safely without duplicating declarations.
