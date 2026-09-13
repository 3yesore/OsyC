# OsyC file-title font scope fix handoff

- **From**: `codex`
- **To**: `integration agent / release captain`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry` @ `39447f4c8a9277207c9542111bb1b4632dab12db` (release candidate `1.0.76`)
- **Change record**: `docs/changes/codex-2026-09-12-title-font-scope-fix.md`
- **Version reservation**: `1.0.76`

## Completed

- Fixed duplicate `.osyc-theme-notes` insertion in nested Markdown selectors.
- Added resolved note variables to `.osyc-theme-notes` so heading fonts are inherited independently of Agent DOM.
- Added a root-scoped `.inline-title` rule for Obsidian file-title layout variants.
- Added regression tests and rebuilt/synced the plugin to the isolated desktop test Vault.

## Verification evidence

```text
npx vitest run src/osyc/theme/themeModel.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts src/osyc/theme/themeScope.unit.spec.ts src/osyc/theme/themePack.unit.spec.ts -> 30 passed
npm run tsc-check -> passed
npm run svelte-check -> 0 errors, 0 warnings
npm run build -> passed
```

## Remaining work

- Reload the plugin in the isolated Obsidian instance and confirm computed `font-family` for `.inline-title` under at least two presets.
- `1.0.76` is published as a GitHub pre-release at `https://github.com/3yesore/OsyC/releases/tag/1.0.76`; mobile BRAT validation is pending.

## Do not change

- Published `1.0.75` tag, Release assets, and BRAT distribution metadata.
- 2c2g/OC servers or backend deployment state.

## Integration notes

- The root-level variable block is intentional: note content is not a descendant of `.osyc-ai-agent`.
- Keep the selector scoping logic when integrating parallel theme changes; reverting to global `.markdown-` string replacement will reintroduce non-matching nested selectors.
