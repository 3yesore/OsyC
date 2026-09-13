# OsyC file-title font scope fix

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/handoff/2026-09-11-theme-rendering-fix.md`
- **Version reservation**: `1.0.76`
- **Status**: `ready for release validation`

## Intent

Ensure the selected theme heading font is actually inherited by Obsidian file titles across reading, live-preview, and source layouts, while keeping note selectors scoped to OsyC.

## Files changed

- `src/osyc/theme/themeModel.ts`: scope each Markdown rule once, expose resolved OsyC note variables on the theme root, and add a layout-independent `.inline-title` rule.
- `src/osyc/theme/themeModel.unit.spec.ts`: regression coverage for heading font inheritance, title targeting, and duplicate-scope prevention.
- `src/osyc/features/AIAgent/appearance.ts`: retain the inline-title selectors used by the note stylesheet.
- `src/osyc/features/AIAgent/appearance.unit.spec.ts`: regression coverage for inline file-title selectors.

## Behaviour and compatibility

- Only `.osyc-theme-notes` descendants are affected; the Obsidian workspace and published `1.0.75` assets are unchanged.
- No remote font loading or settings migration is introduced.
- The selected heading font and heading scale are inherited from the OsyC theme root, including when Obsidian places `.inline-title` outside the rendered Markdown subtree.

## Verification

```text
npx vitest run src/osyc/theme/themeModel.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts src/osyc/theme/themeScope.unit.spec.ts src/osyc/theme/themePack.unit.spec.ts
npm run tsc-check
npm run svelte-check
npm run build
```

- Result: `30 passed`; TypeScript passed; Svelte 0 errors/0 warnings; production build passed.
- Device or environment: isolated desktop Obsidian test Vault `C:\Users\Y2516\Desktop\OsyC-Theme-Pack-Pilot-Vault`; rebuilt plugin copied to `.obsidian/plugins/obsidian-livesync/main.js`.

Additional closeout checks: all 14 built-in presets passed root-variable/title-selector checks; `npx vitest run src/osyc` passed 20 files / 188 tests; iOS 15 compatibility passed; source and isolated Vault `main.js` SHA-256 both equal `7E85BDDA574C6D1EC9912EF5DA498A80B3B1A8E4424CEE6FBCA7123ECF7543A6`.

Candidate package: `C:\Users\Y2516\Documents\Codex\2026-09-01\ben\outputs\osyc-brat-1.0.76-20260912-094304.zip`. The archive contains exactly the five BRAT assets and all manifest versions are `1.0.76`.

## Known gaps

- The currently running Obsidian process must reload the plugin or restart before it can display the rebuilt stylesheet.
- iOS/BRAT acceptance still requires a separately reserved release version.
- `utils/release-process.unit.spec.ts` has two baseline failures in legacy version-bump fixtures (expected `0.25.81` / `1.0.0-beta.0` while the current package is `1.0.75`); release contract and collaboration checks pass.

## Integration request

Merge the source and test changes into the reserved `1.0.76` candidate. Keep stable `1.0.75`, its tag, Release assets, and server deployments unchanged; publish only after the exact five-asset build passes BRAT validation.
