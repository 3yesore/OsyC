# OsyC local font resource mounting handoff

- **From**: `codex`
- **To**: `integration agent`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry` @ `c774c4b7`, `4c839db9`
- **Change record**: `docs/changes/codex-2026-09-12-font-resource-mount.md`
- **Version reservation**: `None`

## Completed

- Vault font imports now use a private plugin path and a validated local-only URL.
- Browser-capable Obsidian runtimes explicitly load each font with `FontFace.load()` and register it in `document.fonts` before applying it.
- Startup restores persisted resources; plugin unload removes the registered faces and runtime style nodes.
- `.woff`, `.woff2`, `.ttf`, and `.otf` CSS format declarations are accurate.
- Custom font options use the imported resource family for availability detection and are available to body, heading, and code selectors.

## Verification evidence

```text
npx vitest run --config vitest.config.unit.ts src/osyc
npm run tsc-check
npm run svelte-check
```

Results: `179 passed`; TypeScript passed; Svelte check `0 errors / 0 warnings`.

## Remaining work

- Run `npm run build`, `npm run check:compatibility`, and `git diff --check` before integration.
- Verify on a real iOS Obsidian device that an imported font changes rendered note body, headings, code blocks, and the settings preview; capture the OsyC diagnostic log if loading fails.
- Release captain must reserve and publish the next candidate only after that evidence; stable `1.0.75` remains immutable.

## Do not change

- Do not alter or republish `1.0.75`.
- Do not add remote font URLs or unlicensed bundled font binaries.
- Do not touch the OC/2c2g servers in this change.

## Integration notes

The feature is intentionally additive and keeps the CSS `@font-face` path for older WebViews. The browser API mount is tracked so hot reloads do not leave stale faces in the document.
