# OsyC Collaboration Bootstrap Plan

## Objective

Establish a shared, auditable workflow for multiple agents maintaining OsyC design documents, implementation changes, handoffs, and releases without version forks or duplicate publication.

## Scope

- Add an OsyC-specific documentation namespace under `docs/`.
- Define append-only agent change records and handoff evidence.
- Create one release ledger for the `3yesore/OsyC` distribution repository.
- Add a read-only checker for source and local distribution metadata.
- Leave the existing `1.0.75` source and BRAT release unchanged.

## Implementation steps

- [x] Add collaboration rules and the active-work register.
- [x] Add change-record and handoff templates.
- [x] Add design, change, handoff, and release documentation indexes.
- [x] Seed the release ledger with the verified `1.0.75` release.
- [x] Add and test the collaboration-state checker.
- [x] Run JSON parsing, focused unit tests, and a clean-worktree review.
- [x] Add a guarded test-package lane: reserved versions may be published as immutable GitHub pre-releases by the owning feature agent; stable promotion remains release-captain-only.

## Verification commands

From the repository root:

```text
node utils/verify-osyc-collaboration.mjs
npx vitest run --config vitest.config.unit.ts utils/verify-osyc-collaboration.unit.spec.ts
git diff --check
git status --short
```

The checker is intentionally local and read-only. Stable tags and promotion remain maintainer-owned checks; the test-package lane may publish only its reserved immutable pre-release after the five-asset checks pass.
