# OsyC bundled font assets

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/design/README.md`, `docs/changes/codex-2026-09-12-font-resource-mount.md`
- **Version reservation**: `None`
- **Status**: `ready for integration`

## Intent

Remove the mobile setup burden of finding and importing font files. The plugin stylesheet now embeds a small, license-compliant font set as WOFF2 data URLs, so BRAT installation supplies the fonts in the existing `styles.css` asset and the existing OsyC font stacks render immediately offline.

## Files changed

- `assets/fonts/`: unchanged WOFF2 source files for Noto Sans SC Simplified Chinese, Inter Latin, and JetBrains Mono Latin, each at weights 400 and 600.
- `styles.css`: generated `@font-face` rules with data URLs and Unicode ranges for the bundled subsets.
- `utils/embed-osyc-fonts.mjs`: reproducible generator for the embedded CSS block.
- `docs/licenses/fonts/`: copyright, SIL OFL-1.1 license, and source package references.
- `src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts`: asserts that the BRAT stylesheet contains all bundled families and data URLs.

## Behaviour and compatibility

- No remote font request is made. The browser uses the embedded data URL and existing CSS family stacks.
- System and unbundled families remain available as normal fallback options; custom Vault import remains available for users who want other fonts.
- The stable `1.0.75` release is not modified or republished. This is a candidate source change pending a new release reservation.
- The embedded set is intentionally limited to keep mobile installation size reasonable; Noto Sans SC is the Simplified Chinese subset, with Latin text supplied by Inter.

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts
npm run tsc-check
npm run svelte-check
npm run build
npm run check:compatibility
git diff --check
```

- Result: focused asset test passed; full OsyC and build checks are required again after integration.
- Device or environment: local Windows build; real iOS rendering still requires mobile acceptance.

## Known gaps

- The bundled Noto subset covers Simplified Chinese ranges; Traditional Chinese and uncommon CJK characters continue to use the declared fallback stack.
- Release asset size grows by roughly 3.2 MB after base64 encoding; this trades download size for a zero-configuration mobile experience.

## Integration request

Integrate the assets, generated stylesheet block, licenses, and generator as one candidate. The release captain must reserve the next version and regenerate the five BRAT assets from the same commit before publishing; do not move or overwrite `1.0.75`.
