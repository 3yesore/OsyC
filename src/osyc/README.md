# OsyC AI 层（与 LiveSync 核心隔离）

本目录 `src/osyc/` 是 **OsyC 自己的程序代码**，与上游 LiveSync 核心（`src/` 下除 `osyc/` 之外的全部内容）在文件上明确隔离。

## 边界约定

- **LiveSync 核心**：`src/` 下除 `osyc/` 之外的所有文件，源自 [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync)（作者 vorotamoroz），保留其完整功能，**不要在此目录内修改 LiveSync 原有逻辑**。
- **OsyC AI 层**：本目录 `src/osyc/`。
  - `features/AIAgent/` —— AI 整理面板、悬浮窗、任务卡片、业务逻辑（`CmdAIAgent`）。
  - `serviceFeatures/useAIAgentUI.ts` —— 把 AI 层接到 Obsidian（命令、侧边栏、悬浮窗挂载、凭据持久化）。
- 完整程序 = LiveSync 完整功能 + OsyC AI 层，构建时由 `src/main.ts` 统一打包进 `main.js`，二者功能互不丢失。

## 依赖方向（只能单向）

OsyC 层 → 依赖 LiveSync 提供的接口（`@/deps.ts`、`@/main` 的 `LiveSyncCore`、`core.services.*`、commonlib），**反之不允许** LiveSync 核心依赖 `osyc/`。

所有 import 走 `@/osyc/...` 别名（tsconfig 已配 `@/* → src/*`），勿写相对路径跨出本目录。

## 版本

版本号由 `manifest.json` 单一真相源驱动，`outputs/github-repo/publish.py` 发布时同步 `package.json` 与 `versions.json`。
