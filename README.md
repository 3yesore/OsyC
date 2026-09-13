# OsyC

OsyC is an Obsidian note assistant with LiveSync-based synchronization. The
official installation channel will be Obsidian Community Plugins. BRAT is
retained only for real-device validation of prerelease builds.

This repository contains auditable plugin assets only: `main.js`, both
manifests, `styles.css`, and `versions.json`. The server-side Hermes adapter,
deployment configuration, credentials, card keys, and vault data are not part
of this repository.

## 2.0.0 migration

This candidate uses the canonical plugin ID `osyc`. At first startup it checks
whether the legacy `obsidian-livesync` plugin is still enabled and stops safely
if it is, preventing two sync instances from running together. After the old
plugin is disabled, OsyC copies its sync settings only when the legacy JSON is
valid and no new configuration exists. The legacy directory remains available
as a rollback copy.

Migration failures never overwrite a new configuration, delete vault files, or
clean up the legacy plugin. Keep the legacy release installed until the mobile
acceptance checks have passed.

## License

OsyC is released under MIT. LiveSync upstream attribution and third-party
notices are included in `LICENSE` and `NOTICE`.
