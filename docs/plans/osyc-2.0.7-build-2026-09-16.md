# OsyC 2.0.7 施工文档（对话界面版式与图标统一）

> **本文是活文档**：施工顺序、每步的验证命令、当前进度与证据都记在这里，按里程碑追加。
> 设计契约见 `docs/plans/osyc-chat-surface-2026-09-16.md`；事后记录见
> `docs/changes/codex-2026-09-16-osyc-chatgpt-layout-and-icon-unification.md` 与
> `docs/handoff/2026-09-16-osyc-chatgpt-layout-and-icon-unification.md`。

- **版本**：`2.0.7`（预发布，用户 2026-09-16 口头授权；`2.0.6` 的 tag 不可移动）
- **分支**：`codex/2.0.6-stabilize`（分支名沿用，版本号由 `manifest.json` 决定）
- **活跃仓库**：`C:/Users/Y2516/Documents/Codex/2026-09-13/jie/worktrees/osyc-review-cleanup`
- **前置**：`2.0.6` 已作为预发布发布（tag @ `0a7dd4d`），用户已确认 UI 验收通过

## 施工原则

1. **先立契约再改码**：改动先在 `*.unit.spec.ts` 里落结构性断言，再动实现。
2. **每个阶段结束必须过门禁**：`npm run check`（含 tsc / eslint / community lint / svelte-check / iOS 15 兼容）+ 定向 Vitest。
3. **文档与代码同提交**：任何代码改动都在同一轮内更新设计/施工/变更记录（项目约定第 1 条）。
4. **指纹与版本**：`npm run check` 会重建 `main.js`，每次重建后 `release-info.json` 即过期，发布前必须刷新。
5. **不移动既有 tag**：`2.0.4`（稳定）与 `2.0.6`（预发布）保持不可变。

## 阶段与进度

| 阶段 | 内容 | 产出 | 验证 | 状态 |
| --- | --- | --- | --- | --- |
| S0 | 前置确认 | 2.0.6 预发布可用、用户 UI 验收通过 | 用户反馈 | ✅ 完成 |
| S1 | 版式施工 | `sessionList.ts` / `osycPanePreferences.ts` / `AIAgentPane.svelte` 重写 | `npm run test:unit -- src/osyc/features/AIAgent` | ✅ 完成 |
| S2 | 图标统一 | `OsycIcon.svelte` + 6 界面改用内置图标 + 白名单门禁 | AIAgent 单测（含 `reviewHygiene`） | ✅ 完成 |
| S3 | 门禁与指纹 | `npm run check` 全绿、`release-info.json` 刷新、文档同步 | `npm run check`、两个 `verify-osyc-*.mjs` | ✅ 完成（`7a42e93` + `27a06cc`） |
| S4 | 2.0.7 版本化 | 四处版本号 + `main.js` 重建 + 指纹 + ledger | `node utils/verify-osyc-release.mjs` | ✅ 完成（`663157b`） |
| S5 | 预发布下发 | 推送 `main` 触发资产上传，BRAT 可装 | `releases/expanded_assets/2.0.7` | 🔄 进行中 |
| S6 | 发布后记录 | ledger 补 `publishedAt`/资产哈希、active-work、本文件与交接文档 | 目录一致性复核 | ⏳ 待办 |
| S7 | 服务器侧推进 | 见 `docs/releases/osyc-2.0.6-launch-baseline.md` 的后端门槛 | 见该文档 | ⏳ 待办（下一阶段） |

## S4 施工步骤（2.0.7 版本化）

1. `package.json` 版本 → `2.0.7`（手动改，**不用** `npm version`，避免它自动建本地 `v2.0.7` tag 与提交）。
2. `node version-bump.mjs`：把 `manifest.json` 与 `versions.json` 提到 `2.0.7`。
3. `manifest-beta.json` 手动同步到 `2.0.7`（`version-bump.mjs` 不管这个文件）。
4. `node update-workspaces.mjs`：同步 `package-lock.json` 与各 workspace 版本。
5. `npm run check`：重建 `main.js`（版本号由 `esbuild.config.mjs` 从 `manifest.json` 注入）。
6. 刷新 `release-info.json`：`version` → 2.0.7、`sourceCommit` → 本次提交、五资产 sha256。
7. `docs/releases/release-ledger.json`：`candidate` 指向 2.0.7（发布前先写 tag + 提交，`publishedAt`/资产哈希在 S6 补）。
8. 提交 → 复核 `git rev-parse HEAD`（本机 git 嵌套 ref 缺陷，`codex/*` 分支必查）。

## S5 施工步骤（下发）

```bash
# 只推已审核的提交；工作流按 manifest.json 的版本号创建 tag 与 Release
git push origin <已审核sha>:refs/heads/main
```

- 触发 `.github/workflows/publish-release-assets.yml`：push 事件 → 新建 Release 默认 **pre-release**，上传 `main.js` / `manifest.json` / `styles.css` 三个资产。
- 验证**不要**用带缓存的抓取工具；用 HTML 端点（不受匿名 API 限流影响）：

```bash
curl -sL https://github.com/3yesore/OsyC/releases/expanded_assets/2.0.7 | grep -o 'main\.js'
```

## 回滚路径

| 目标 | 做法 |
| --- | --- |
| 客户端回滚 | BRAT 装回 **2.0.4**（稳定版；`2.0.5` 有 tag 但无 Release，不可用） |
| 客户端回滚到上一预发布 | 装 **2.0.6**（tag @ `0a7dd4d`，可用） |
| 服务器回滚 | `/srv/osyc/backups/20260915-stable205-pre` |

## 进度日志（追加）

- **2026-09-16** S0 完成：用户反馈「UI 验证通过」，随后授权「优化对话页 UI、侧边栏展开、图标」。
- **2026-09-16** S1+S2 完成：提交 `7a42e93`（代码/测试/`styles.css`/重建 `main.js`）。新增 3 个文件、改写 1 个、修掉 2 个静默样式缺陷。
- **2026-09-16** S3 完成：提交 `27a06cc`（文档 + 指纹）。门禁：AIAgent 196 用例通过；`npm run check` 全绿（svelte-check 0 错 0 警）；两个 `verify-osyc-*.mjs`（含 `--check-refs`）exit 0。
- **2026-09-16** 用户授权把这批改动作为 **2.0.7 预览版**下发；同时要求补齐细颗粒度设计文档与施工文档（本文件与 `osyc-chat-surface-2026-09-16.md`）。
- **2026-09-16** S4 完成：提交 `663157b`。四处版本号 + 三个 workspace + `package-lock.json` 全部到 2.0.7；`main.js` 重建后 `verify-osyc-release.mjs` 判 `aligned: 2.0.7`；`release-ledger.json` 把 2.0.7 记为 reserved、2.0.6 移入 `previousCandidate`；门禁 `npm run check` 全绿。
- **2026-09-16** 施工中发现的**本机 git 缺陷复发**：本仓库分支 ref 实际存于 `packed-refs`，其值停在 `0a7dd4d`（落后 3 个提交），新提交对象与 reflog 正常但 loose ref 未落盘，`HEAD` 因此回退到旧提交。已写回 loose ref 修复，并把工作分支切到扁平名 `codex-2.0.6-stabilize`（扁平 ref 实测可写）从根上避开；`main.js` 的构建产物未受影响。
- **2026-09-16** S5 开始：刷新 `release-info.json`（`sourceCommit` = `663157b`，五资产哈希）。
