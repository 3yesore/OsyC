# OsyC 1.0.78 sync, font, and theme fix

## Scope

- Restore the backend `POST /api/sync/handshake` endpoint and expose its read-only snapshot through `GET /api/status`.
- Preserve a newer successful client handshake when a stale `/api/status` snapshot arrives later.
- Align bundled Noto Sans SC family names with the font stacks used by appearance settings and provide bundled fallbacks for unsupported local families.
- Resolve curated typography from the selected appearance preset, while retaining the older colour-preset fallback for migrated settings.
- Bridge `--font-text`, `--font-editor`, `--font-monospace`, and Chinese Writing variables to OsyC note font tokens inside the scoped original theme packs.

## Validation

- Plugin focused tests: appearance, CmdAIAgent, and theme model all pass.
- Backend `tests/test_flow.py`: 23 passed, including handshake and status snapshot checks.
- Full plugin and backend regression plus production package validation are required before publishing the BRAT pre-release.

## Deployment note

The backend source now contains the endpoint, but the OC server must be deployed from the matching backend package before mobile users can observe the handshake fix. No server content was changed in this worktree.
