# Change Record: OsyC 设置改走原生设置页并清理死代码

- **Agent**: `codex`
- **Date**: `2026-09-16`
- **Branch**: `codex/2.0.6-stabilize`
- **Related design**: `docs/plans/osyc-settings-account-ui-2026-09-11.md`, `docs/adr/2026_08_declarative_settings_adapter.md`
- **Version reservation**: `2.0.6`（沿用已预留的候选版本，不新开版本号）
- **Status**: `published as the OsyC 2.0.6 GitHub pre-release`（已审核发布提交 `0a7dd4d`，tag `2.0.6`）；稳定版提升待移动端验收

## Intent

把 OsyC 自己的偏好设置从自建弹窗搬进 Obsidian 原生设置页，消除「设置弹窗 + 运行时各存一份状态」的结构性隐患，并删掉因此产生的死代码。用户侧的结果是：设置项从 19 条平铺、无分组的一段长列表，变成 `连接 / 外观 / 交互 / 诊断` 四个带标题的原生分组，外观高频项直接呈现、低频的颜色与背景收进一个可展开分组。

## Files changed

- `src/osyc/features/AIAgent/osycSettingsPane.ts`（新增）：原生设置页渲染器。用官方 `Setting` 组件 + `addPane` 分组标题渲染四个分组；只消费 `OsycSettingsController`，不持有任何偏好。
- `src/osyc/features/AIAgent/osycSettingsController.ts`（新增）：设置页与运行时之间的桥（快照读取 + 逐项写入 + 字体导入 + 资源 URL 解析 + 日志/诊断入口）。
- `src/osyc/serviceFeatures/useAIAgentUI.ts`：删除死代码 `AIAgentSettingModal`（约 280 行，唯一引用来自自身声明）；把 `BODY_FONT_OPTIONS`/`CODE_FONT_OPTIONS`/`fontOptionsWithAvailability`/`appendFontPreview`/`updateFontPreview` 迁到设置页模块；装配期注册控制器、卸载时摘除。
- `src/modules/features/SettingDialogue/SettingsPageCatalogue.ts`：新增根分组 `osyc`（`🧠 OsyC`）与页面目录项 `osyc`（`order: 10`，`content: "custom"`，`legacy: paneOsyc`）。
- `src/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts`：把 `🧠 OsyC` 根分组插进声明式页面列表，位置在同步分组之后。
- `src/osyc/features/AIAgent/AIAgentAccountModal.ts` + `.unit.spec.ts`：账户与权益弹窗改为官方分组标题 + `<details>` 折叠（概览 / 权益总览 / 同步状态在前，设备与自带 Key、账户操作默认收起）。
- `src/osyc/features/AIAgent/AIAgentToolsModal.ts` + `.unit.spec.ts`：工具中心与账户弹窗明确分工——工具中心不再重复展示积分、到期时间与权益总览，只留账户入口、Cloud-Vault 备份与 OsyC 设置。
- `src/osyc/features/AIAgent/AIAgentPaneView.ts`, `AIAgentPane.svelte`：顶部账户条从展示型 `<div>` 改为可点击按钮，直连「我的账户与权益」。
- `styles.css`：补充账户弹窗徽章行、折叠块与移动端触控尺寸样式。
- 相关单元测试：`useAIAgentUI.unit.spec.ts`（重写为 `osycSettingsPane`/`osycSettingsController` 双文件契约）、`SettingsPageCatalogue.unit.spec.ts`、`ObsidianLiveSyncSettingTab.declarative.unit.spec.ts`、`AIAgentPane.mobile.unit.spec.ts`。
- `utils/verify-osyc-collaboration.mjs` + `utils/verify-osyc-collaboration.unit.spec.ts`：发布后修复的治理缺陷。该脚本原先只接受「工作区版本 == `currentStable.version`」，因此在候选线领先稳定版（工作区 2.0.6、稳定版 2.0.4）时会把 `main` 判红。现改为：工作区版本等于 `currentStable.version` 或 ledger 记录的 `candidate.version` 均通过，等于第三个版本号仍报错；并新增「候选 tag 不可移动」「带 tag 的候选必须有 `releaseUrl`」两条断言。单测由 5 条扩到 11 条。

## Behaviour and compatibility

- 偏好存储位置不变：仍是 `<vault>/.obsidian/livesync-aiagent.json`，键名与结构未动，不触发迁移。
- 写入路径收敛为一处：设置页只调用控制器，`persist()` 仍是唯一落盘点；服务地址改为停止输入 800 ms 后提交，避免逐字写文件。
- 设置页的读写只在运行时装配完成后可用；控制器未注册时页面显示「OsyC 服务尚未就绪」而不是抛错。
- 页面走 `content: "custom"`，因此 1.13 之前的命令式设置界面同样能看到该页；此前 OsyC 设置在任何版本都无入口，本次是纯增量。
- 根分组排序在 `Quick Setup` 与 `Synchronisation` 之后、`General Settings` 之前，不改变「未配置时 Quick Setup 置顶」「已配置时同步置顶」两条既有约定。
- `ActiveNoteConsentModal` 仍保留（标注为交给持久化迁移），本次不动。

## Verification

```text
npm run test:unit -- --run src/osyc src/modules/features/SettingDialogue
npm run tsc-check
npm run lint
npm run check
node utils/verify-osyc-release.mjs
```

- Result: `38 files / 292 tests passed; tsc 0 errors; lint 0 errors（9 条既有 warning）; npm run check 通过含 iOS 15 兼容检查; 五资产哈希与 release-info.json 一致`
- Device or environment: `Windows local unit suite + production build`

## Known gaps

- `npm run test:unit` 会稳定地有 1 条用例失败：`utils/release-process.unit.spec.ts > runs release metadata scripts when the selected version is already the package version`，在并发负载下超过 5000 ms 超时（本轮实测 7035 ms / 10560 ms），**单独复跑该文件 21/21 通过**。这是上游既有用例的超时阈值问题，与本轮改动无关，但是发布前需要知道的一个噪声源。
- 手机端（iOS/Android）BRAT 真机验收未做：设置页的四分组布局、折叠项展开手势、以及从账户条直连账户弹窗的触控路径需要真机确认。预发布 `2.0.6` 已发布，可直接用 BRAT 的 beta 通道安装验证；这也是稳定版提升前的唯一阻塞项。
- 设置页未做 UI 截图回归；`docs/adr/2026_06_real_obsidian_e2e.md` 描述的 e2e 设置界面用例（`test:e2e:obsidian:settings-ui`）未在本次运行。
- `release-info.json` 指纹**已刷新**（`756327d`）：`sourceCommit` = `3c9765dc1a2445f3637912740df0562a1a063fa0`（HEAD 的父提交），五资产全部 MATCH，`verify-osyc-release.mjs` exit 0。注意仓库内没有生成脚本，`release-info.json` 靠人工维护。
- **本机 git 无法写入 `refs/heads/` 下的嵌套 ref，且静默返回成功**（rc=0、无报错、reflog 照写，但 loose ref 文件不落盘，导致 `HEAD` 变 unborn）。本次提交时 `codex/2.0.6-stabilize` 因此一度消失，已用直接写文件的方式重建。对本分支任何后续提交都必须复核 `git rev-parse HEAD`。完整复现矩阵与规避方式见 `docs/handoff/2026-09-16-osyc-native-settings-page.md` 待办第 6 条。

## Publication

`0a7dd4d` 已推送并以 GitHub 预发布发布：`main` 快进推送（`bafb839..0a7dd4d`）触发 `.github/workflows/publish-release-assets.yml`，2026-09-16 18:18 +0800 完成。标签 `2.0.6` 指向 `0a7dd4d`，Release 标记为 pre-release；三个上传资产（`main.js` / `manifest.json` / `styles.css`）的 sha256 与本地 `release-info.json` **逐字节一致**。稳定版 `2.0.4` 的 tag 与 Release 未做任何改动，回滚路径有效。

## Integration request

合并源码、测试与治理脚本改动。本次不要求版本号变更：`2.0.6` 已在 `codex/2.0.6-stabilize` 上预留，并已消耗为预发布。若要把 `2.0.6` 提升为稳定版，须先完成移动端 UI 验收，并按 `docs/releases/osyc-2.0.6-launch-baseline.md` 的后端启动门槛推进；提升动作属 release-captain。
