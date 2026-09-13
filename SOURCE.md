# Source disclosure

This repository now includes the client source required for Obsidian review.

- `src/` contains the complete client source at the OsyC identity-migration
  revision `668f0b22`, including the MIT-licensed LiveSync-derived modules and
  OsyC-owned `src/osyc/` integration code for migration, AI tasks, themes, and
  explicit Vault consent.
- `main.js` and `styles.css` are generated distribution assets for the stable
  release. They must be regenerated from the same source revision before each
  release; no server-side code is bundled into the plugin.

The backend Hermes adapter, deployment configuration, provider/API keys,
activation cards, and user Vault data are private operational components and
are not required to run the Obsidian client review build.
