# OsyC font catalog and theme research

Date: 2026-09-11
Branch: `codex/osyc-1.0.67-sync-entry`
Release boundary: candidate only; stable `1.0.75` remains unchanged.

## Font catalog

Added device-font stacks for MiSans, HarmonyOS Sans, Alibaba PuHuiTi, Smiley Sans, Sarasa Gothic, Inter, IBM Plex Sans, Atkinson Hyperlegible, Literata, Noto Sans Mono, Source Han Mono, Sarasa Mono, Maple Mono, Iosevka, and Victor Mono. The settings page exposes the new body/heading choices and code-only monospace choices. No font binary or remote URL is bundled; unavailable families follow the declared fallback stack.

## Theme snapshots

Read-only shallow clones are stored outside the repository at `C:/Users/Y2516/WorkBuddy/osyc-theme-sources-20260911` for visual and CSS review. Snapshot commits and licenses:

| Project | Commit | License | Use |
| --- | --- | --- | --- |
| Minimal | `c4704fbc23625f4b35b0ab9b2e1eb584e6891be2` | MIT | visual/variable reference |
| Border | `05d2df5d157e15f13be1a43da2d3034c995dd8e2` | MIT | visual/information hierarchy reference |
| Things | `9b8bef93d3919f7693ac78597beaa35bbbd4cfff` | MIT | mobile interaction reference |
| AnuPpuccin | `82d207c646904e7af371ced499f682fbdfad1012` | GPL-3.0 | visual reference only; not copied |
| Chinese Writing Layout | `420c5b3598ec09a6f0ef4e3450506cdce861207d` | MIT | Chinese typography reference |
| Codex Style Markdown | `490f94b18887dd8642e79bd5bd0960c92732f2f1` | MIT | scoped Markdown/content reference |
| CodeSplash Themes | `6fb48eee070bffc2c4776ca78e4710f8f1914a18` | MIT | token/editor reference |
| Image Layouts | `a130e0a5ecc061ffae498f81bb15894826d9aa19` | MIT | media layout reference |

These snapshots are for review only. OsyC does not copy complete theme CSS, does not introduce third-party runtime dependencies, and does not use AnuPpuccin source because its GPL obligations are outside the current integration boundary.
