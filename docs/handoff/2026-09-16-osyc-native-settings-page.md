# OsyC 原生设置页与账户 UI 交接

记录 2026-09-16 完成的 OsyC 设置信息架构调整。改动本身不触碰同步协议与后端契约；同日按「先做 UI 再发布」的节奏，把该候选作为 `2.0.6` **GitHub 预发布**推给 BRAT 做真机验收（未做稳定版提升、未部署后端、未移动任何既有 tag）。

## 结论

2.0.6 候选已推送并以上述预发布形式发布：`main` 快进到已审核提交 `0a7dd4d`，`2.0.6` 标签与预发布 Release 由 `.github/workflows/publish-release-assets.yml` 自动创建，2026-09-16 18:18 +0800 完成资产上传。稳定通道仍解析到 `2.0.4`，社区插件稳定版未变更。本轮改动只影响 OsyC 自身的设置界面与账户界面，不触及同步协议、后端契约或持久化格式。

## 改动内容

### 设置：自建弹窗 → 原生设置页

| 项目 | 改动前 | 改动后 |
| --- | --- | --- |
| 承载方式 | `AIAgentSettingModal`（自建 `Modal`） | 原生设置页 `🧠 OsyC` 分组 |
| 可达性 | **无入口**（类存在但无人实例化，死代码） | 同步分组之后、通用设置之前 |
| 分组 | 19 条平铺，仅靠 `h4` 分隔 | `连接 / 外观 / 交互 / 诊断` 四个 `addPane` 分组 |
| 外观 | 快速调整 + `详细调整` 折叠 | 高频项直出，颜色与背景收进 `更多颜色与背景` 折叠 |
| 读写 | 弹窗持有一份值，`保存` 时回写 | 设置页只读快照，改动即时回写唯一运行时 |

新增文件：

- `src/osyc/features/AIAgent/osycSettingsPane.ts` — 渲染器，只消费控制器。
- `src/osyc/features/AIAgent/osycSettingsController.ts` — 桥接口 + 注册表。

被删除的死代码：`AIAgentSettingModal`（约 280 行）。它的唯一引用来自自身声明，`AIAgentToolsModal.unit.spec.ts` 里有一条断言专门防止它被重新接回。

### 账户与工具中心分工

- `AIAgentAccountModal`：改为官方分组标题 + `<details>` 折叠。首屏顺序为 概览 → 权益总览 → 同步状态；`设备与自带 Key`、`账户操作` 默认收起；新增徽章行。
- `AIAgentToolsModal`：标签由「账户与权益」改为「账户」，移除与账户弹窗重复的积分、到期时间、权益总览、OC 整理任务、私有同步、Cloud-Vault 展示，只保留账户入口、Cloud-Vault 备份与 OsyC 设置入口。
- `AIAgentPane.svelte` / `AIAgentPaneView.ts`：顶部账户条由展示型元素改为按钮，直连账户弹窗。

## 验证证据

```text
npm run check                     # EXIT 0
  tsc-check                       0 errors
  tsc-check:apps                  0 errors
  lint                            0 errors, 9 existing warnings
  lint:community                  clean
  lint:community:tools            clean
  svelte-check                    0 errors, 0 warnings
  check:compatibility (iOS 15)    passed
vitest run src/osyc src/modules/features/SettingDialogue   38 files / 292 tests passed
```

## 发布状态（GitHub API 复核于 2026-09-16）

- 当前稳定版：`2.0.4`（2026-09-14 发布）。
- 前一稳定版：`2.0.3`。
- **`2.0.5` 只有 tag、没有 GitHub Release**，因此它不能作为 BRAT 可安装的回滚点；有效回滚目标是 `2.0.4`。
- `2.0.6`：**已作为预发布发布**。

### 2.0.6 预发布证据（2026-09-16 18:18 +0800 / 10:18 UTC）

| 项目 | 值 |
| --- | --- |
| 已审核发布提交 | `0a7dd4d8812ba3d688d3e9ad26915a40f27f00db` |
| 标签 | `2.0.6`（指向上述提交） |
| Release | `https://github.com/3yesore/OsyC/releases/tag/2.0.6`，标记 **Pre-release** |
| 上传资产 | `main.js` / `manifest.json` / `styles.css`（外加 GitHub 自动生成的源码包） |

| 资产 | GitHub 实测 sha256 | 本地 `release-info.json` |
| --- | --- | --- |
| `main.js` | `4d1a7c1e…4ecc3df` | 一致 |
| `manifest.json` | `9ba5f9f6…2f65317` | 一致 |
| `styles.css` | `a011369a…047969ba` | 一致 |

推送方式：`git push origin 0a7dd4d:refs/heads/codex/2.0.6-stabilize`，随后 `git push origin 0a7dd4d:refs/heads/main`（快进，`bafb839..0a7dd4d`）。**注意**：本仓的发布触发点就是「推送 `main`」，`publish-release-assets.yml` 会在 push 事件下把新建 Release 默认标记为预发布（`requestedPrerelease ?? true`），而后续普通 push 不会把已稳定的 Release 改回预发布。

### 顺手修复的治理缺陷

发布后 `main` 的工作区版本变成 `2.0.6`，而 `release-ledger.json` 的 `currentStable` 仍是 `2.0.4`，于是 `utils/verify-osyc-collaboration.mjs` 会把 `main` 判红——它此前只能表达「工作区版本 == 稳定版」，无法表达「候选线领先稳定版」这一合法状态。已修正为：工作区版本只要等于 `currentStable.version` 或 ledger 记录的 `candidate.version` 即通过（等于第三个版本号仍然报错），并新增候选 tag 不可移动、带 tag 的候选必须有 `releaseUrl` 两条断言，配套 11 条单测。

## 如何在手机上装这个预发布版

1. BRAT 里对 `3yesore/OsyC` 使用「Add beta plugin」路径（BRAT 的 beta 开关需要打开，否则只会解析到稳定版 `2.0.4`）。
2. 版本应显示为 `2.0.6`。仓库根目录的 `manifest-beta.json` 与 `manifest.json` 现在都是 `2.0.6`，两者一致，BRAT 不会再有「beta 与 manifest 版本不符」的提示。
3. 装完先确认能进 `设置 → 🧠 OsyC`，再看四个分组（连接 / 外观 / 交互 / 诊断）与「更多颜色与背景」折叠项。
4. **回滚**：把 BRAT 里的 beta 开关关掉即可退回稳定版 `2.0.4`；`2.0.4` 的 Release 与 tag 本次未做任何改动。

## 待办

1. **真机验收（未完成，当前唯一阻塞项）**：iOS/Android 上确认四分组布局、折叠项展开、账户条点击路径。
2. ~~推送与发布~~ **已完成**：分支与 `main` 均已推送，`2.0.6` 预发布已生成（证据见上）。
3. ~~提交与重新生成五资产指纹~~ **已完成**：`3c9765d` 提交了 22 个文件（设置页迁移 + 文档），`756327d` 提交了 `release-info.json`（`sourceCommit` = `3c9765dc1a2445f3637912740df0562a1a063fa0`，即 HEAD 的父提交）。复核结果：

   | 资产 | 结果 |
   | --- | --- |
   | `main.js` | `4d1a7c1e…4ecc3df` MATCH |
   | `styles.css` | `a011369a…047969ba` MATCH |
   | `manifest.json` / `manifest-beta.json` / `versions.json` | MATCH |

   `node utils/verify-osyc-release.mjs` → `OsyC release contract aligned: 2.0.6`（exit 0）。

   注意：仓库内没有任何脚本会生成或校验 `release-info.json`；它靠人工维护，这也是它此前漂移的原因。`npm run check` 重建 `main.js` 是**幂等**的（重建前后 SHA-256 完全一致），因此指纹在提交后仍然有效。
4. **`docs/releases/release-ledger.json` 已记录 2.0.6 预发布**：`candidate` 段补上了 `tag` / `releaseUrl` / `publishedAt` / `publishedAssets` / 三资产 sha256，`sourceRepository` 与 `distributionRepository` 的 commit 都更新为 `0a7dd4d`。同时补了一条此前缺失的说明——ledger 里的「五个 BRAT_ASSETS」指的是**仓库内受版本管理的文件**，而 GitHub Release 实际上传的是 BRAT 真正下载的 3 个（`main.js` / `manifest.json` / `styles.css`），`manifest-beta.json` 与 `versions.json` 从仓库树读取；这条说明解释了这个长期看起来自相矛盾的地方。稳定版提升动作仍属 release-captain。
5. 后端门槛见 `docs/releases/osyc-2.0.6-launch-baseline.md`（该文档是 2026-09-15 的快照，刻意不回改）。它的插件发布门槛现已满足，但后端门槛全部未动：带 diagnostics/email 契约的版本化后端候选、后端测试、health / runtime-info / 零成本 dry-run、四个低成本验收样例、以及桌面 + 移动端 UI 验收。`/api/error-reports` 与 `/api/auth/email/*` 目前仍返回 404。下一步的服务器推进以这些为准。
6. **【新增·高优先级】本机 git 无法写入 `refs/heads/` 下的嵌套 ref，且静默返回成功。**

   2026-09-16 提交时发现分支引用凭空消失。实测结论（可复现）：

   | ref 名 | 形态 | `git update-ref` 结果 |
   | --- | --- | --- |
   | `refs/heads/watchprobe-flat` | 扁平 | rc=0，**文件正常落盘** |
   | `refs/heads/aaa-nest/watchprobe` | 嵌套 | rc=0，**文件不存在** |
   | `refs/heads/codex/watchprobe2` | 嵌套 | rc=0，**文件不存在** |

   即：`git commit` / `git update-ref` 会把**新提交对象与 reflog 正常写入**（`cat-file`、`logs/refs/heads/codex/…` 均可见），但 `refs/heads/codex/<分支>` 这个 loose ref 文件**不会被创建**，命令却返回 0 且无任何报错。因此 `HEAD` 会变成 unborn（`git worktree list` 显示 `0000000`）。

   排查已排除项：无 git hook（`hooks/` 只有 `.sample`）；`packed-refs` 不包含 heads；`repositoryformatversion = 0`、非 reftable；`GIT_*` 环境变量干净；OneDrive 相关目录均非 reparse point。`refs/remotes/origin/codex/*`（同为嵌套）完好，说明并非所有嵌套路径都受影响。

   规避与修复：

   - **规避**：改分支命名，避免 `refs/heads/<目录>/<分支>` 这种两层结构（例如改用 `codex-2.0.6-stabilize`）。
   - **修复**：直接用文件写入重建 ref（写 40 位 SHA + 换行，即 loose ref 的标准格式），随后用 `git show-ref --heads` 验证：
     ```text
     C:\Users\Y2516\.workbuddy\binaries\python\versions\3.13.12\python.exe -c "import os;p=os.path.join(r'<repo>\.git','refs','heads','codex','2.0.6-stabilize');os.makedirs(os.path.dirname(p),exist_ok=True);open(p,'w').write('<sha>'+chr(10))"
     ```
   - **纪律**：在本机对 `codex/*` 分支做任何提交后，**必须**立即 `git rev-parse HEAD` 复核；若报 unborn，按上述方式重建 ref。
   - **根因未定**：该机装有零信任/EDR 类安全代理，其文件系统过滤驱动是主要嫌疑；建议把仓库移出 `Documents`，并为仓库路径加安全软件排除项，再复测。

## 相关记录

- 变更记录：`docs/changes/codex-2026-09-16-osyc-native-settings-page.md`
- 计划：`docs/plans/osyc-settings-account-ui-2026-09-11.md`
- 声明式设置适配器设计：`docs/adr/2026_08_declarative_settings_adapter.md`
