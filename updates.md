# 1.0

Well then, everyone: it has been roughly a year since I declared the 0.25 beta. During that time, we have concentrated mainly on fixing defects and completing the features that the project needed.

Version 1.0 has been in mind for some time. We have now brought together the work intended to make it possible: stronger CI, more detailed tests, an E2E runner suited to synchronisation, and testing tools for physical devices. These now form a coherent Kit rather than a collection of isolated pieces. With those foundations in place, it seems that the time has finally come to reshape the structure of this repository.

None of this would have been possible without your issue reports, pull requests, sponsorship, and the support provided through OpenAI's Codex for Open Source. I would like to express my gratitude once again. As with every pull request contributed to the project, code produced with Codex and similar tools is reviewed and audited by me, vrtmrz. Anyone interested in how I manage that process can refer to my dotfiles.

This will call for your help once again. I would be very grateful for your co-operation as we build a sounder foundation for the project and its future development.

Earlier releases remain available in the 1.0 release history, the 1.0 preview history, the 0.25 release history, and the legacy release history.

## Unreleased

- OsyC `2.0.14` takes every Cloudflare endpoint out of the AI Agent's runtime paths. The official service address is the direct `https://api4.sacu3.cn` only; the historical `api.sacu3.cn` and `osyctest.sacu3.cn` names both resolve to Cloudflare (`Server: cloudflare`, measured TTFB median ~1.5 s versus ~0.29 s direct) and now migrate to `api4` instead of being retried. All backend requests funnel through `CmdAIAgent.apiRequest` + `tryEndpointsInOrder`; the direct fallback list is intentionally empty because no second direct API entry exists yet. See `docs/changes/codex-2026-09-20-endpoint-failover-direct-only.md`.

## 2.0.13

20th September, 2026

- OsyC `2.0.13` adds a **recharge entry** to the AI Agent account dialog: an integer-credit card key can be redeemed on the current account without leaving Obsidian, and any campaign bonus is reported back ("充值成功，另赠 N 积分"). The card key is never displayed or persisted.
- OsyC `2.0.13` adds **email sign-in** as an identity anchor above activation cards. The account dialog sends a six-digit code to a mailbox, signs in with it, and binds an existing card key to that mailbox; once a card is linked, the same mailbox plus a fresh code is enough to obtain a device token on a new device, so there is no card key to recover. The binding is authorised by an account session token issued on verification — never by a client-chosen device identifier — and email sessions stay in memory instead of being written to disk.
- OsyC `2.0.13` unifies the brand assets behind a single logo file at the repository root (`OsyC-logo.png`, derived sizes under `assets/brand/`, documented in `docs/BRAND_ASSETS.zh.md`) and drops the "笔记助手" suffix from user-facing signatures, which now read `OsyC`.
- OsyC `2.0.13` also carries the build hygiene from the original cut: two unchecked type assertions were removed (the LiveSync remote-configuration reroute `planCouchDbRemoteConfigurationReroute`, where the surrounding `typeof === "string"` guard already proves the type, and the AI Agent UI settings reader `useAIAgentUI`, where `currentSettings()` is already assignable), and the lint gate is back to zero errors.
- OsyC `2.0.13` publishes no 2.0.12 regression: the release contract, `tsc`, the unit suite and the versioned assets are re-verified against the same source tree that produced the build.

## 2.0.12

18th September, 2026

- OsyC `2.0.12` makes activation survive an existing configuration profile: LiveSync 2.x overlays the profile named by `activeConfigurationId` over the top-level `couchDB_*` keys, so activation now rewrites that profile as well. A top-level-only write was reverted by the old endpoint on any device that already had a profile.
- OsyC `2.0.12` pins `remoteType` to CouchDB during activation, so a legacy `minio` or `p2p` value cannot route the replicator to the wrong remote.
- OsyC `2.0.12` presets the official service address `https://api4.sacu3.cn` and migrates the historical official endpoints, so a fresh install can activate after pasting a card key without setting the API base by hand.

## 2.0.11

18th September, 2026

- OsyC `2.0.11` makes activation actually start syncing. The setup URI payload carries no `liveSync` key and the LiveSync default is `false`, so the replicator never opened: a fresh activation reached `doc_count = 1` on its tenant database and the server-side vault stayed empty. The activation patch now opens the master switch, and a load-time repair opens it for devices that were activated before this build.
- OsyC `2.0.11` stops showing an estimated credit cost while a task is queued or running; the cost chip appears once the task settles.
- OsyC `2.0.11` left-aligns the rows of the session list; Obsidian's button base style had centred them.

## 2.0.10

17th September, 2026

- OsyC `2.0.10` stops a finished task from leaving liveness heartbeats in the conversation. The terminal filter now hides every progress phase instead of four of them, and the heartbeat merge keeps only its newest tick, so a long run no longer accumulates one persisted row every eight seconds.
- OsyC `2.0.10` publishes directly as a normal release. A push to the default branch no longer creates a pre-release, because the Obsidian Community directory matches published releases only, and `verify-release-channel.yml` checks that invariant hourly.

## 2.0.9

17th September, 2026

- OsyC `2.0.9` replaces the in-plugin settings entry itself: the tools centre, the account modal and the request-open-settings event now open a native Obsidian `Modal` that renders the same OsyC pane, because `openTabById` can only reach this plugin's settings page and that page opens on a group list rather than on the settings. The LiveSync-only remote configuration stays reachable from an explicitly labelled footer entry.
- OsyC `2.0.9` promotes the `OsyC` root group to the first position on the native settings landing page.

## 2.0.8

17th September, 2026

- OsyC `2.0.8` fixes the settings jump: `openObsidianSettings()` opened the settings window before selecting a tab, and the account modal passed a LiveSync settings *group* identifier where Obsidian expects a tab identifier (those group objects carry no id at all).
- OsyC `2.0.8` fixes the appearance baseline: `toAppearance()` wrote `preset` into `colourPreset`, so any non-theme typography preset silently applied that preset's hard-coded palette and the chat surface stopped following the Obsidian theme.
- OsyC `2.0.8` stops reporting a hard failure for a first activation: `POST /api/activate` provisions the sync target asynchronously, so it returns an empty `setup_uri` with `provisioning_status = "pending"`. The plugin now reads the provisioning status and retries instead of reporting "configuration failed".

## 2.0.7

16th September, 2026

- OsyC `2.0.7` aligns the assistant layout with the intended desktop chat composition and unifies the icon set across the assistant surfaces. Released as a preview build for device acceptance.

## 2.0.6

16th September, 2026

- OsyC `2.0.6` moves announcements into an Obsidian-native modal with cached unread state, adds explicit tool-center navigation, and keeps floating panels mutually exclusive.
- OsyC `2.0.6` adds user-confirmed, tenant-bound diagnostic upload with field allowlisting, redaction checks, idempotency, encrypted short-term retention, and no Vault content upload.
- OsyC `2.0.6` keeps the existing response delta and artifact intent contracts; email login remains disabled for a later release.

- Candidate OsyC `2.0.0` introduces the standalone plugin ID `osyc` for Community Plugins distribution. It includes a guarded migration path from the legacy `obsidian-livesync` directory, preserves the shared Agent configuration file, blocks dual sync instances, and keeps the existing MIT licensing and LiveSync attribution. This release must remain prerelease until migration and mobile network acceptance pass.

- Candidate OsyC `1.0.78` restores the `/api/sync/handshake` contract and sync snapshot in the backend, keeps a fresh handshake from being overwritten by stale status data, aligns bundled font family names with shipped assets, and bridges original theme typography variables to OsyC note fonts. Focused tests pass; server deployment and mobile BRAT acceptance remain pending.

- Candidate OsyC `1.0.77` package replaces user-facing AI/Agent labels with `OC` and removes RMB-equivalent quota amounts from the account entitlement summary; internal quota accounting and API fields are unchanged.
- Candidate OsyC theme-rendering fix extends scoped styling to real Markdown and CodeMirror content roots, adapts Agent surfaces to OsyC preset tokens, and adds isolated background-image rendering with live font previews. Focused tests and iOS compatibility checks pass; real-device acceptance and release reservation remain pending.
- Expanded the device-font catalog with additional Chinese, Latin, and monospace fallback stacks; added read-only source snapshots and license records for the reviewed open-source themes and layout modules.

## 2.0.5

14th September, 2026

- OsyC `2.0.5` aligns the plug-in metadata and release assets, hardens the repeatable release workflow, and preserves the 2.0.4 compatibility and dialogue behaviour.

## 1.0.77

12th September, 2026

- Renamed visible AI/Agent entry points and response labels to `OC` across the mobile and desktop plugin UI.
- Removed RMB-equivalent model quota amounts from the account entitlement summary without changing backend quota state or billing behaviour.

## 1.0.76

12th September, 2026

- Fixed OsyC theme heading fonts for Obsidian file titles across reading, live-preview, and source layouts.
- Corrected scoped Markdown selectors so nested content rules are applied once and remain isolated to OsyC note views.

## 1.0.75

11th September, 2026

- Reissued the BRAT package from one release commit so the tag, source fingerprint, and all five assets remain aligned.
- Added an explicit client-side runtime compatibility gate: a server that declares an incompatible plugin range is rejected before a task request is sent.
- Completed the local background-image preview path and strengthened font-preview precedence in the OsyC appearance settings.

## 1.0.74

11th September, 2026

- Extended scoped note theming to code blocks, inline code, quotes, tables, callouts, embeds, and dividers so content blocks no longer fall back to Obsidian default surfaces.
- Strengthened note font, size, line-height, and colour declarations across reading, live preview, and source editor content.
- Reworked the appearance preview as a static full-width sample and added live font samples below each font selector for mobile-friendly comparison.

## 1.0.73

11th September, 2026

- Repackaged the OsyC Agent and scoped theme updates as a distinct BRAT release after `1.0.72`, with aligned plugin metadata and API entry points.
- Streams the authoritative Hermes visible response through `response_text`, merges legacy preview events without truncating to the last fragment, and removes transient lifecycle labels at terminal state.
- Removes the duplicate OC assistant name and keeps ordinary chat inline without generating Markdown artifacts.
- Records a safe `/api/runtime-info` fingerprint so mobile diagnostics can detect backend/adapter release mixing.

## 1.0.72

11th September, 2026

- Improved OsyC Agent conversation rendering with native Obsidian Markdown output, readable Chinese typography, and stable streaming message identities.
- Added explicit Artifact intent handling so ordinary chat does not create redundant Markdown files; requested reports retain natural titles and safe conflict suffixes.
- Kept synchronization status compact in the Agent header while preserving account and credit information.
- Added versioned, scoped OsyC theme and local-font safety adapters with readable fallbacks and no remote font loading.
- Hardened streaming updates, phase-event merging, and delivery-state rendering so stale analysis or sync messages do not remain after completion.

## 1.0.70

11th September, 2026

- Reorganised the OsyC account view so plan entitlements, model quota, queue priority, device limits, Cloud-Vault capacity, and readable skill names are shown in separate mobile-friendly sections.
- Reorganised OsyC settings into Connection, Note appearance, and Agent interaction sections while retaining native controls and live preview.

## 1.0.69

- Automatically normalize legacy `/osyc` API base URLs to the current Hermes service root, restoring status, LiveSync handshake, and task requests after the public Tunnel migration.

## 1.0.68

- Explain outdated API endpoints when refreshing the LiveSync handshake instead of showing a generic failure.

## 1.0.67

- Added account actions to re-activate a card key or refresh the LiveSync handshake without invoking a model or charging credits.
- Added safe server-side sync coverage summary to the account view.

## 1.0.65

- Keep legacy progress fallbacks out of the chat and show verified reading and clarification details alongside the streamed OC reply.

## 1.0.60

6th September, 2026

- Cleaned up OC assistant streaming so `response_text` stays the authoritative reply and repeated preview fragments no longer stack into the chat.
- Tightened dialogue intent detection so ordinary整理任务 mentioning `profile` or `skill` no longer fall into capability disclosure.

## 1.0.21

26th August, 2026

It is becoming more 'ordinary' with each release, but please let me know if anything has become less convenient.

### Interface and translation

#### Fixed

- Remote Configuration section headings no longer overlap their contents when scrolling on mobile. Action buttons in Remote Configuration, Maintenance, and Patches now remain inside the settings pane on narrow screens.

## 1.0.20

~~1.0.19~~ was cancelled because prerelease validation exposed an incorrect warning at start-up.

25th August, 2026

I know this is the second time I have said it, but I had grown quite fond of the settings screen. It seems, however, that a simpler, healthier life is called for.

### Interface and translation

#### Fixed

- Compatibility pause warnings now direct you to the dedicated compatibility review instead of the Change Log.
- The Obsidian 1.13 settings page now waits for saved settings before choosing its initial layout. This prevents a spurious missing-replicator warning at start-up, keeps configured devices on the Synchronisation-first layout even when automatic synchronisation triggers are disabled, and keeps Quick Setup first on unconfigured devices.

#### Improved

- Settings page names, controls in General Settings, Quick Setup actions, and Advanced controls now use Obsidian 1.13's native settings interface and global search, while retaining their familiar icons. The landing page keeps Remote Configuration and Sync Settings together, places Appearance, Logging, and Extra menus under General Settings, and groups maintenance, optional features, advanced settings, and help by purpose. Earlier supported Obsidian versions continue to use the pane-based interface.
- Settings changes which require database initialisation now use a focused Setup Manager dialogue to choose between existing synchronisation data and the files in the current Vault. The selected reset or rebuild is reserved before the settings are saved, while cancelling offers a separate, explicit settings-only fallback.

## 1.0.18

24th August, 2026

### Synchronisation and storage

#### Fixed

- Reset and rebuild workflows now use the local database selected by their updated settings, preventing stale data from reopening after a **Database Suffix** change. If database initialisation does not complete, the workflow remains paused instead of continuing with incomplete state.

#### Improved

- Rebuilds now recheck restored file events against the current Vault, use current file contents, and finish processing them before the plug-in reports readiness.

## 1.0.17

23rd August, 2026

### Interface and translation

#### Fixed

- Settings generated from the settings manifest, Setup Wizard configuration summaries, and warnings about externally changed settings now honour **Display language** when a translation is available, instead of remaining in English (PR #1123). Thank you to @nimula for the contribution!

### Peer-to-peer synchronisation

#### Improved

- P2P connection profiles now provide four **P2P message size** presets and a **Connection path** choice between **Automatic** and **TURN relay only**. Smaller messages can improve compatibility on paths which fragment or drop larger WebRTC messages, while relay-only routing requires a configured TURN server. P2P connection strings and encrypted Setup URIs preserve both choices.
    - Thank you to @andrewschreiber for the detailed fragmentation diagnosis and working 800-byte threshold in vrtmrz/livesync-commonlib#97, which informed this compatibility design.
- An optional self-hosted Coturn Compose starter is now available for P2P deployments that need a TURN relay. It uses a pinned upstream image and documents its network, credential, security, and verification boundaries.

## 1.0.16

19th August, 2026

### Conflict handling and recovery

#### Fixed

- **Back to this revision** in Document History now restores the selected content as a new non-deleted successor revision before reflecting it to the Vault. A readable revision restored after a logical deletion therefore remains restored through later synchronisation instead of being overwritten by the deletion.
    - If the file changes while restoration is in progress, the operation stops instead of extending a stale revision. Existing conflicts remain available through **Inspect conflicts and file/database differences**.

### Synchronisation and storage

#### Improved

- One-shot CouchDB synchronisation now releases stalled web-compatible connection checks before replication starts, so a later synchronisation can make a fresh attempt (Commonlib 0.1.16).
    - The 60-second safeguard applies only to pre-replication checks. It does not limit ordinary synchronisation, and the **Use Internal API** path is unchanged.
