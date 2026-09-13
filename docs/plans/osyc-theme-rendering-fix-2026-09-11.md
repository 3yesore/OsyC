# OsyC Theme Rendering Fix Plan

## Goal

Make OsyC appearance settings observable in real Obsidian note views, the static settings preview, and the Agent pane on iOS and desktop. Preserve `1.0.75` as an immutable release baseline.

## Root causes

- Font choices are CSS stacks only. Unsupported families silently fall back, and the existing font-resource validation is not connected to the renderer.
- Theme scope is applied only to the current Markdown leaf container and does not cover every Obsidian reading, live-preview, or CodeMirror 6 content root.
- Background image opacity is exposed as a variable but has no rendering layer. Existing saved opacity `0` therefore hides the image.
- Agent child rules continue to consume Obsidian host variables, so OsyC presets do not reach the header, composer, cards, or code blocks.

## Implementation sequence

1. Add failing unit contracts for real view selectors, background-layer opacity, Agent token mapping, and scope refresh for newly created leaves.
2. Extend the appearance renderer with a single scoped token adapter and a visible background layer with deterministic defaults.
3. Expand scope synchronisation to Markdown view content roots and dynamic workspace changes.
4. Connect safe local Vault font resources to the selected font family without remote loading or unlicensed bundled fonts.
5. Make the settings preview use the same token and background renderer, and show resolved/fallback font state.
6. Adapt Agent child surfaces and controls to OsyC tokens while retaining Obsidian fallbacks when the preset follows the host theme.
7. Run focused tests, TypeScript/Svelte checks, production build, iOS compatibility check, and a manual desktop/iOS acceptance checklist.

## Release boundary

The work is a candidate change only. Do not move or overwrite the `1.0.75` tag or Release. The release captain decides the next patch version after real-device validation.
