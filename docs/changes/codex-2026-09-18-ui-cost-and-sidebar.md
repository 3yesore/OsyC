# Change Record: 去掉「预计积分消耗」+ 会话记录首字左对齐

- **Agent**: `codex` (dsh session)
- **Date**: `2026-09-18`
- **Branch**: `codex-sync-activation-repair`
- **Related**: user feedback, 2026-09-18
- **Version reservation**: none (proposed for the next patch)
- **Status**: `verified locally`

## Intent

Two user-visible defects reported on 2026-09-18:

1. the conversation showed an **estimated** credit cost (预计 N 积分) while a task was still queued or running;
2. the session list in the sidebar did not start its text at the left edge.

## Root cause

1. `AIAgentAssistantMessage.svelte` and `AIAgentTaskCard.svelte` derived `estimated` from the task status, then rendered `{estimated ? "预计 " : ""}-{cost} 积分` using `estCost` while running. That estimate is a submission reservation, not a real charge.
2. `.ai-session-item` set `text-align: left` but not `justify-content`. Obsidian's own `button` base style centres its content, and it wins for the flex container, so the status icon and the message were laid out around the centre. `.ai-session-label` had no `flex` or `min-width: 0`, so the label could not claim the remaining width.

## Files changed

- `src/osyc/features/AIAgent/AIAgentAssistantMessage.svelte`: the cost chip renders only once the task is terminal (`{#if !estimated && cost > 0}`), so it shows the settled charge and never an estimate.
- `src/osyc/features/AIAgent/AIAgentTaskCard.svelte`: the same rule (this component is currently unmounted, kept consistent).
- `src/osyc/features/AIAgent/AIAgentPane.svelte`: `.ai-session-item` gains `justify-content: flex-start`; `.ai-session-label` gains `flex: 1 1 auto`, `min-width: 0` and an explicit `text-align: left`.

## Behaviour

- While a task runs, no credit figure is shown; when it finishes, the settled cost appears exactly as before.
- Session rows always start at the left padding edge, with the state icon first and the message label filling the rest of the width.

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc/features/AIAgent/livesyncActivation.unit.spec.ts src/osyc/features/AIAgent/CmdAIAgent.unit.spec.ts
npm run tsc-check
npm run svelte-check
```

- `vitest`: 2 files / 53 tests passed.
- `tsc --noEmit`: exit 0.
- `svelte-check`: 0 errors, 0 warnings.

## Known gaps

- No screenshot-level device verification of the sidebar alignment.
- The backend `est_cost` field is untouched; only the client display changed.
