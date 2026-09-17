# OsyC terminal progress cleanup (heartbeat leftovers + unbounded growth)

- **Agent**: `codex`
- **Date**: `2026-09-17`
- **Branch**: `codex-2.0.6-stabilize`
- **Related design**: `docs/changes/README.md`; UI read model `src/osyc/features/AIAgent/conversationModel.ts`
- **Version reservation**: `2.0.10`
- **Status**: `cut into 2.0.10; verification rerun in the release worktree`

## Intent

A finished task kept rendering the backend's liveness heartbeat as a stack of
process rows after the reply, e.g. six rows of `模型正在思考（已 32 秒，暂无新输出）`
did 40/48/56/64/72 on a task that had already reported its cost and re-enabled the
composer. Remove every interim marker once a task reaches a terminal status, and
stop the heartbeat from accumulating one persisted row per 8 seconds.

## Root cause

Two defects compounded:

1. **Allowlist drift.** `EPHEMERAL_PROGRESS_MESSAGES` named only four phases
   (`analyzing`, `model_output`, `model_activity`, `reading`), so
   `visibleProgressEvents` only hid those at terminal status. The backend actually
   emits ten phases; the six it left behind were `waiting`, `preparing`,
   `dialogue`, `generating`, `retrying`, `verifying`.
   `waiting` is written every 8 s (`app/agent/hermes.py`, `VISIBLE_HEARTBEAT_SECONDS = 8.0`),
   so it produced the most rows.
2. **Unbounded merge.** `progressEventKey` is `phase\0message\0count`, and the
   heartbeat message embeds elapsed seconds, so every tick was a unique key. The
   merge never deduplicated or trimmed them, the terminal branch of the poll loop
   never cleared `progressEvents`, and the array is persisted to plugin data and
   restored verbatim — so the leftovers survived a plugin reload.

The UI reported exactly six rows because `displayProgressEvents` ends in `.slice(-6)`.

## Files changed

- `src/osyc/features/AIAgent/conversationModel.ts`:
    - `visibleProgressEvents` is now default-deny: non-terminal returns the events
      unchanged, terminal returns `[]`. A phase the backend adds later can no longer
      leak into a finished conversation.
    - `mergeProgressEvents` keeps only the newest `waiting` tick (`HEARTBEAT_PROGRESS_PHASES`).
    - Removed `EPHEMERAL_PROGRESS_MESSAGES` and `isEphemeralProgressEvent`; they had
      no other references in the repository.
- `src/osyc/features/AIAgent/conversationModel.unit.spec.ts`: added a regression
  assertion that covers all six previously leaking phases across
  `done`/`failed`/`cancelled`/`interrupted`/`failed_zero_cost` while keeping them
  visible while `running`, plus a heartbeat-collapse assertion.

## Behaviour and compatibility

- While a task is queued or running, every progress row renders exactly as before
  (heartbeat included) — the live "模型正在思考" feedback is preserved.
- Once a task is terminal, no progress row renders; the reply, artifacts,
  confirmation prompts and cost display are untouched.
- Because the fix is in the render path, already-persisted dirty state needs no
  migration: reopening the conversation hides it immediately.
- No wire-format, backend, settings or storage-schema change. No new icons.

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc/features/AIAgent/
npm run tsc-check
npm run svelte-check
```

- Result: **`vitest` passed — 14 test files / 156 tests, 0 failures.**
  `conversationModel.unit.spec.ts` contributes 13 of those, including the two new
  assertions. (`vite-plugin-svelte` reported "no Svelte config found … using default
  configuration", which is expected for the unit config.)
  `node_modules/` started out **empty** in this checkout, so `npm install` had to run
  first; before it finished, the behaviour was already verified independently by
  importing the real `conversationModel.ts` through Node 22 type stripping —
  **14/14 pass** — covering the same points:
    - original behaviour preserved: the four historical phases stay visible while
      `running` and disappear at `done`;
    - all six previously leaking phases are hidden for `done`, `failed`,
      `cancelled`, `interrupted`, `failed_zero_cost`, `conflict`, `delivery_failed`;
    - the heartbeat stays visible while running;
    - a simulated 1-hour run collapses to exactly **one** heartbeat row (450 before);
    - `mergeProgressEvents` idempotency for non-heartbeat phases, plus
      `mergeModelOutputEvents` and `buildConversationMessages`, are unchanged.
      Harness: `outputs/_tests/verify_progress_model.mjs`
      (`node --experimental-strip-types verify_progress_model.mjs`). Raw logs:
      `outputs/_tests/aiagent_unit.txt` (vitest),
      `outputs/_tests/verify_out.txt` (direct-import harness).
      **Re-run in the release worktree for 2.0.10** (`osyc-review-cleanup`, dependencies
      present): `npm run tsc-check` exit 0, `npm run svelte-check` 0 errors and
      0 warnings, and the full unit suite (`vitest run --config vitest.config.unit.ts src`)
      passed **120 files / 934 tests**. Log: `outputs/_tests/osyc-2.0.10-verify.txt`.
- Manual verification done instead: the four edits were applied with a literal
  replacement driver (`apply_edits.py`, exact hit counts, all-or-nothing, re-read
  after write) and the changed regions were read back from disk.
- Existing coverage was thin here: `conversationModel.unit.spec.ts` asserted only
  the original four phases, and `AIAgentAssistantMessage.unit.spec.ts` only checks
  that the filter string exists. That is why the leak went unnoticed.

## Known gaps

- The type, Svelte and unit gates now pass in the release worktree, so the earlier
  hold on publication is lifted; the fix is cut as `2.0.10`.
- `AIAgentTaskCard.svelte` is unmounted dead code with the same
  `visibleProgressEvents` call, so it inherits the fix for free; it is still not
  covered by tests.
- The backend still returns up to 40 rolling `progress_events`; the duplicate
  preview bursts at task end (26 of 40 repeated rows on the observed task) are a
  server-side concern and were **not** changed here.
- `progress_events` heartbeats are still emitted at 8 s intervals; only the client's
  retention changed.

## Integration request

The fix is cut into `2.0.10` from `codex-2.0.6-stabilize`, together with the
release-channel guard (`fix(release): keep the default branch manifest on a
published release`). Review the two source files and the spec, then push the cut
commit to `main`, which publishes `2.0.10` as a normal release. Do not move the
`2.0.4`, `2.0.8` or `2.0.9` tags.
