# OsyC theme rendering fix

Date: 2026-09-11
Branch: `codex/osyc-1.0.67-sync-entry`
Release boundary: candidate only; stable `1.0.75` remains unchanged.

## Changed

- Extended note theme scope to Markdown reading, live-preview, rendered, and CodeMirror 6 roots, including roots created after plugin startup.
- Added OsyC token adapters for Agent surfaces, controls, messages, code blocks, tables, callouts, quotes, embeds, and dividers.
- Added an isolated background image layer with a visible first-use opacity default when a valid image is selected.
- Applied note font, heading font, size, line-height, colour, and code-font declarations to the actual Obsidian content selectors.
- Kept the settings preview full-width and static, with live font samples below each font selector and Vault-resource background resolution.

## Verification

- Focused Vitest: 4 files, 32 tests passed.
- `npm run tsc-check`: passed.
- `npm run svelte-check`: 0 errors, 0 warnings.
- `npm run build`: passed.
- `npm run check:compatibility`: iOS 15 passed.
- `git diff --check`: passed.

## Deferred

`fontResources.ts` currently provides validation and safe `@font-face` construction only. Importing arbitrary Vault font files is intentionally deferred until licensing, file-copy, deletion, and settings UX contracts are approved. No remote font is loaded.
