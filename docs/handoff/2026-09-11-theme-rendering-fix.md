# OsyC theme rendering fix handoff

Date: 2026-09-11
Owner: Codex
Branch: `codex/osyc-1.0.67-sync-entry`

## Scope

This handoff covers the candidate fix for note and Agent theme rendering. It does not publish a release and does not alter the immutable `1.0.75` tag or BRAT assets.

## Implementation

- `appearance.ts` now emits OsyC-scoped note tokens and content-block rules, with isolated `::before` background layers and stronger font declarations.
- `themeScope.ts` applies the opt-in class to Markdown leaf containers and real nested view roots.
- `useAIAgentUI.ts` refreshes scopes on layout/active-leaf changes and observes dynamically created workspace content; background selection gets a visible default opacity.
- Focused tests cover rendered/live-preview/source selectors, background layers, Agent token mapping, and dynamic scope updates.

## Validation evidence

`npx vitest run --config vitest.config.unit.ts src/osyc/features/AIAgent/appearance.unit.spec.ts src/osyc/theme/themeScope.unit.spec.ts src/osyc/theme/themeModel.unit.spec.ts src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts` -> 32 passed.

`tsc-check`, `svelte-check`, production build, iOS 15 compatibility, and `git diff --check` all passed on 2026-09-11.

## Known gaps and next owner

- Real iOS and desktop Obsidian acceptance is still required for font availability, graphite block surfaces, background images, split panes, and source/live-preview transitions.
- Local Vault font import remains deferred; do not add bundled fonts without a license decision.
- Release captain must reserve the next version, reconcile this branch with any parallel changes, and publish only after real-device evidence. `1.0.75` remains the stable baseline.
