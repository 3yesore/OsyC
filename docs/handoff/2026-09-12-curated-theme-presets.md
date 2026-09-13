# OsyC curated theme presets

- **From**: `codex`
- **To**: `integration agent`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry` @ `6bce9d8d`
- **Change record**: `docs/changes/codex-2026-09-12-curated-theme-presets.md`
- **Version reservation**: `None`

## Completed

- Added seven built-in presets inspired by reviewed open-source Obsidian themes and layout projects.
- Connected the shared preset option map to the mobile-friendly OsyC appearance settings.
- Kept local fonts, scoped note styling, and existing user overrides intact.

## Verification evidence

```text
npx vitest run --config vitest.config.unit.ts src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts
2 test files passed; 33 tests passed
```

## Remaining work

- Review and merge the proposal into formal design/construction documents.
- Run the full OsyC type, Svelte, build, compatibility, and release-contract checks.
- Reserve a new release only after real iOS and desktop acceptance.

## Do not change

- Published `1.0.75` tag, release assets, or distribution commit `a1f1085`.
- Any server deployment or the existing release ledger state.
- Third-party GPL source or complete theme CSS.

## Integration notes

- The source branch still contains the earlier bundled-font and font-mount changes; review the complete working-tree diff before integration.
- The settings dropdown intentionally uses `THEME_PRESET_OPTIONS` from `appearance.ts` so parsing and UI labels cannot drift.
