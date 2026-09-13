# OsyC

OsyC is an Obsidian plugin that combines a local note workspace with an AI
assistant and optional LiveSync-based synchronization. The plugin is released
under the MIT license. The public repository contains the auditable client
source and the build assets; the server-side Hermes adapter remains separate.

## What it does

- Organizes, summarizes, and generates Markdown from notes when you request an
  AI task.
- Reads or writes Vault files through the Obsidian Vault API.
- Supports optional synchronization through a server configured by the user.
- Preserves the legacy `obsidian-livesync` configuration during the `osyc` ID
  migration and blocks two synchronization instances from running together.

## Network, accounts, and paid service

OsyC connects to the backend URL you configure for account activation, AI
requests, task status, and optional synchronization. A network connection is
not required for ordinary local Obsidian note editing. Full AI service access
requires an OsyC account or activation card; quotas and paid entitlements are
enforced by the configured service, not by the plugin bundle.

When you explicitly send a task, the selected Vault content and the requested
editing context may be sent to that backend for processing. The service may
retain task metadata and audit records for reliability and abuse prevention.
Retention, deletion, billing, and support procedures are described in the
[OsyC privacy policy](https://github.com/3yesore/OsyC/blob/main/PRIVACY.md) and
[terms of service](https://github.com/3yesore/OsyC/blob/main/TERMS.md).

The plugin does not include client telemetry, dynamic advertising, silent
installation, or self-update logic. API keys and activation cards are not
stored in this repository or written to release assets.

## Source and build

The `src/` directory contains the auditable LiveSync-derived client source and
OsyC integration modules. `main.js` and `styles.css` are the corresponding
distribution assets. The server, deployment files, provider credentials,
activation-card database, and Vault contents are intentionally excluded.

## License and attribution

OsyC is MIT licensed. LiveSync upstream source remains under its original MIT
license and is credited in [`NOTICE`](NOTICE). Third-party notices are kept in
the repository so downstream users can review the complete attribution chain.

## Reporting issues

Please include the OsyC version, Obsidian version, operating system, and a
redacted diagnostic log. Do not attach Vault contents, activation cards, API
keys, or server credentials.
