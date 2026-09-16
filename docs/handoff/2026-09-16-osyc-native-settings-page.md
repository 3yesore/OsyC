# OsyC 原生设置页与账户 UI 交接

记录 2026-09-16 完成的 OsyC 设置信息架构调整。本次不发布、不部署、不移动任何 tag。

## 结论

2.0.6 候选在本地已具备发布条件（`npm run check` 全绿、全量单测通过、五资产哈希自洽），但**尚未推送、尚未发布**。本轮新增的改动只影响 OsyC 自身的设置界面与账户界面，不触及同步协议、后端契约或持久化格式。

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
- `2.0.6` 无 tag、无 Release。本轮改动**已提交**到 `codex/2.0.6-stabilize`（`3c9765d` 设置页 + `756327d` 指纹），分支领先 origin **12** 个提交，**尚未推送**。

## 待办

1. **真机验收（未完成）**：iOS/Android 上确认四分组布局、折叠项展开、账户条点击路径。
2. **推送（未完成）**：两个提交已在本地，`git push` 尚未执行。执行前请先读第 6 条。
3. ~~提交与重新生成五资产指纹~~ **已完成**：`3c9765d` 提交了 22 个文件（设置页迁移 + 文档），`756327d` 提交了 `release-info.json`（`sourceCommit` = `3c9765dc1a2445f3637912740df0562a1a063fa0`，即 HEAD 的父提交）。复核结果：

   | 资产 | 结果 |
   | --- | --- |
   | `main.js` | `4d1a7c1e…4ecc3df` MATCH |
   | `styles.css` | `a011369a…047969ba` MATCH |
   | `manifest.json` / `manifest-beta.json` / `versions.json` | MATCH |

   `node utils/verify-osyc-release.mjs` → `OsyC release contract aligned: 2.0.6`（exit 0）。

   注意：仓库内没有任何脚本会生成或校验 `release-info.json`；它靠人工维护，这也是它此前漂移的原因。`npm run check` 重建 `main.js` 是**幂等**的（重建前后 SHA-256 完全一致），因此指纹在提交后仍然有效。
4. **`docs/releases/release-ledger.json` 本次已按 GitHub API 复核结果修正**（此前停留在 1.0.75 时代）；发布动作本身仍属 release-captain。
5. 后端 `stable206` 与 `/api/error-reports`、`/api/auth/email/*` 的门槛见 `docs/releases/osyc-2.0.6-launch-baseline.md`，本轮未触碰。
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
