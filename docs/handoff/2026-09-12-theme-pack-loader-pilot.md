# OsyC original theme pack loader pilot

- **From**: `codex`
- **To**: `integration agent`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry` @ `ea975b0e`
- **Change record**: `docs/changes/codex-2026-09-12-theme-pack-loader-pilot.md`
- **Version reservation**: `None`

## Completed

- Bundled original Minimal and Chinese Writing Layout CSS into the build through fixed local assets.
- Added workspace/raw and notes/scoped loading modes with a replaceable style node.
- Added settings, persistence, safe token parsing, license metadata, and regression tests.

## Verification evidence

```text
npx vitest run --config vitest.config.unit.ts src/osyc
20 test files passed; 186 tests passed
npm run tsc-check
npm run svelte-check
npm run build
npm run check:compatibility
```

## Remaining work

- Install the local build into desktop Obsidian and compare both scopes against the original themes.
- Repeat on iOS with a representative Markdown note containing headings, callouts, code, tables, embeds, and images.
- Review bundle size and selector exceptions before expanding to the remaining MIT themes.

## Do not change

- Published `1.0.75` tag/release or distribution commit `a1f1085`.
- Release ledger or server deployment.
- GPL theme source or third-party full theme packages outside the two MIT pilot packs.

## Integration notes

- Build reads `assets/themes/*/original.css`; those files must remain present in any release-preparation checkout.
- `themePackId` is independent of the earlier token presets, so disabling the original pack leaves the OsyC preset path unchanged.
