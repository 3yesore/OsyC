# OsyC local font resource mounting

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/changes/codex-2026-09-11-font-catalog-and-theme-research.md`
- **Version reservation**: `None`
- **Status**: `ready for integration`

## Intent

Make Vault-imported fonts actually usable on desktop and mobile Obsidian. A font is now copied into the OsyC private plugin directory, validated as a local resource, explicitly loaded through the browser `FontFace` API when available, and then referenced by the same family in Agent, note, heading, code, and settings-preview CSS. Unsupported WebViews retain the CSS `@font-face` fallback path.

## Files changed

- `src/osyc/theme/fontResources.ts`: added a local-only `FontFace` descriptor and corrected `woff`, `woff2`, `ttf`, and `otf` format declarations.
- `src/osyc/serviceFeatures/useAIAgentUI.ts`: mounts imported and persisted resources with `FontFace.load()`, rejects failed imports, cleans mounted faces on unload, and checks custom families for availability in all three selectors.
- `src/osyc/theme/fontResources.unit.spec.ts`: covers descriptor validation and all supported font formats.
- `src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts`: covers explicit mount/unmount and custom-family selector wiring.

## Behaviour and compatibility

- Only `app://` and `file://` resource URLs are accepted; remote font URLs remain forbidden.
- Imported files stay under `.obsidian/plugins/obsidian-livesync/fonts/` and are not added to the synced note content.
- A failed `FontFace.load()` removes the newly copied file and reports a device-local notice; existing persisted resources use the CSS fallback if the WebView lacks the FontFace API.
- The stable `1.0.75` tag and BRAT assets are untouched. No version metadata was changed.

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc
npm run tsc-check
npm run svelte-check
```

- Result: `179 passed`; TypeScript passed; Svelte check reported `0 errors and 0 warnings`.
- Device or environment: local Windows build; real iOS loading still requires mobile acceptance.

## Known gaps

- Font family metadata is taken from the Vault filename; if a font's internal family name differs, the filename remains the selectable family alias.
- Real iOS Obsidian acceptance is still required for each font format and for WebView CSP/resource-path behaviour.

## Integration request

Merge the source and test changes as one candidate feature. Do not bump release metadata or publish BRAT until the release captain reserves a new version and mobile acceptance confirms a real custom font changes note text, headings, code, and preview rendering.
