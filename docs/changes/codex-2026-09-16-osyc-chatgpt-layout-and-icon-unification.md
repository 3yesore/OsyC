# Change Record: OsyC 对话页改为 ChatGPT 版式并统一图标

- **Agent**: `codex`
- **Date**: `2026-09-16`
- **Branch**: `codex/2.0.6-stabilize`
- **Related design**: `docs/plans/osyc-settings-account-ui-2026-09-11.md`, `docs/changes/codex-2026-09-16-osyc-native-settings-page.md`
- **Version reservation**: `None`（`2.0.6` 已消耗为预发布且 tag 不可移动，本改动不得复用该版本号；下一个补丁版本号待 release-captain 预留）
- **Status**: `ready for integration`

## Intent

在移动端 UI 验收通过之后（2026-09-16 用户反馈「UI 验证通过」），继续收敛对话界面的观感：把「顶部状态卡 + 平铺会话列表 + 定高输入框」改造成 ChatGPT 式版式，并把此前用 Unicode 字符和 emoji 顶替的图标全部换成 Obsidian 内置图标。用户侧的结果是：会话按时间分组便于回找、侧边栏可以收成图标栏腾出阅读宽度、输入框随草稿增高、六个界面的图标风格一致且跟随主题颜色。

## Files changed

- `src/osyc/features/AIAgent/sessionList.ts`（新增）：会话列表分组读模型。`sessionRecencyLabel` + `groupSessionsByRecency` 按**本地日历日**切边界（今天 / 昨天 / 前 7 天 / 更早），用 `startOfLocalDay` + `Math.round` 计算天数差，跨夏令时不会漂移；分组按由新到旧排列且跳过空桶。
- `src/osyc/features/AIAgent/sessionList.unit.spec.ts`（新增）：5 条单测，覆盖四档边界、本地日历日边界、排序、不产生空分组。
- `src/osyc/features/AIAgent/osycPanePreferences.ts`（新增）：OsyC 面板 UI 偏好（当前仅 `osyc-pane-sidebar-collapsed`）。读写走 `app.loadLocalStorage`/`app.saveLocalStorage`，并用 `requireApiVersion("1.8.7")` 兜底，模式与 `documentHistoryPreferences.ts` 一致。
- `src/osyc/features/AIAgent/OsycIcon.svelte`（新增）：图标组件。`$effect` 里先 `replaceChildren()` 再 `setIcon()`，避免 Obsidian 的 `setIcon` 追加语义导致重复渲染；尺寸通过 `--osyc-icon-size` 传递。
- `src/osyc/features/AIAgent/AIAgentPane.svelte`（重写）：ChatGPT 式版式 —— 侧栏（新会话按钮 / 分组会话列表 / 底部动作区）、顶栏（折叠开关 / 移动端菜单 / 公告入口 / 账户条）、消息区、输入区（胶囊 + 自动增高 + 圆形发送键）。`SESSION_STATUS_ICON` 为 10 个生命周期状态各配一个内置图标；折叠态在 `>720px` 收成 56px 图标栏，移动端保留抽屉 + 遮罩。
- `src/osyc/features/AIAgent/AIAgentAssistantMessage.svelte`：`📄` 换成 `OsycIcon`，错误/交付行同样改为内置图标；OC 头像样式从 pane 作用域移入本组件。
- `src/osyc/features/AIAgent/appearance.ts`：`agentThemeAdapterCss` 中把侧栏与对话区分层（`--osyc-ai-surface-alt` vs `--osyc-ai-surface`），并**取消**对用户气泡的强调色强制（原来用 `!important` 把气泡涂成 accent 色，与 ChatGPT 的中性气泡不符）。
- `src/osyc/features/AIAgent/AIAgentToolsModal.ts`：标签页与按钮改用内置图标（`user`/`credit-card`/`bug`/`database`/`settings`/`copy`）。
- `src/osyc/features/AIAgent/AIAgentAccountModal.ts`：`trash-2`/`check`/`x`/`settings`/`refresh-cw`/`key`。
- `src/osyc/features/AIAgent/AnnouncementModal.ts`：`refresh-cw`/`check`。
- `src/osyc/features/AIAgent/osycSettingsPane.ts`：原生设置页剩余 7 个按钮补齐图标（`download`/`rotate-ccw`×4/`file-text`/`copy`）。`addPane` 的 emoji 分组标题是 LiveSync 全局 pane 标题约定（`heading = \`${icon} ${name()}\``），**保持不动**。
- `styles.css`：新增 `.ai-tools-tab-icon`，`.ai-tools-tab` 改为 flex 对齐。
- 单元测试：`AIAgentPane.mobile.unit.spec.ts`（新增 8 条 ChatGPT 版式契约）、`reviewHygiene.unit.spec.ts`（图标卫生，见下）、`AIAgentToolsModal.unit.spec.ts`（标签页图标断言）。

## Behaviour and compatibility

- 偏好存储：侧栏折叠状态写进 Obsidian 的 per-vault local storage（`app.saveLocalStorage`），**不写** `<vault>/.obsidian/livesync-aiagent.json`，不新增同步字段、不触发迁移。
- 图标名全部取自本机 Obsidian 1.13.7 内置图标表（该 asar 内共 1994 个 id），逐个比对过。**未知图标名 Obsidian 不报错、只静默渲染成空白**，因此新增白名单断言把拼写错误挡在提交前，而不是等到真机才发现。
- 图标白名单当前 27 个名字，分布在 6 个界面文件。新增图标必须先确认在本机内置图标表内，再追加到 `OSYC_ICON_VOCABULARY`。
- emoji 禁用规则覆盖 5 个文件（对话页、助手气泡、工具中心、账户弹窗、公告）。**设置页豁免**：`addPane` 的 🧠/🔌/🎨/🖱️/🧰 属于 LiveSync 全插件通用的分组标题约定，单独改会造成不一致，需要上游层面统一才有意义。
- 版式契约仍受既有门禁约束：`.ai-chat { height: 100%; }`、`.ai-composer { flex: 0 0 auto;`、`.ai-chat-timeline, .ai-task-list`、`max(8px, env(safe-area-inset-bottom))` 保留；未引入 `position: sticky`、`window.visualViewport`、`--ai-viewport-height`。
- `AIAgentTaskCard.svelte` 仍是未被挂载的遗留组件（pane 侧有 `not.toContain("AIAgentTaskCard")` 门禁，它自身仍被 `brandCopy.unit.spec.ts` 读取），本轮**未改**，其内部的 emoji 状态图标一并留着；清理它需要同时改 3 个测试文件与 1 篇变更记录，不属本轮范围。

## Verification

```text
npm run test:unit -- src/osyc/features/AIAgent
npm run check
node utils/verify-osyc-collaboration.mjs
node utils/verify-osyc-release.mjs
```

- Result: `AIAgent 目录 20 文件 / 196 用例通过；npm run check 全绿（tsc 0 错、eslint 0 错、community lint 通过、svelte-check 0 错 0 警、iOS 15 兼容通过）；verify-osyc-release.mjs exit 0（aligned: 2.0.6）；verify-osyc-collaboration.mjs exit 0，加 --check-refs 仍 exit 0（aligned: 2.0.4）；图标白名单断言 27 个名字全部命中本机内置图标表`
- Device or environment: `Windows local unit suite + production build`；用户侧 UI 验收在预发布 `2.0.6` 真机上完成

## Known gaps

- **本轮改动没有可发布的版本号**：`2.0.6` 的 tag 与 GitHub 预发布已指向 `0a7dd4d` 且不可移动，本改动（`7a42e93`）比预发布更新。要下发到用户必须由 release-captain 预留下一个补丁版本（`2.0.7`）并重建资产；本轮**未**推送 `main`、**未**新建 tag、**未**动 `2.0.4`/`2.0.6` 任何既有 Release。
- 侧栏折叠的持久化只做了单测级验证（`loadOsycPaneBooleanPreference` 的读写分支），真机上「折叠 → 重开 Obsidian → 仍折叠」这条路径未实测。
- 输入框自动增高的 `COMPOSER_MAX_HEIGHT = 180` 与 CSS `max-height: 180px` 是两处硬编码，靠注释维持一致；没有断言把它们绑在一起。
- 移动端抽屉（`<=720px`）与安全区交互在真机上只做过用户主观验收，没有截图回归。
- `release-info.json` 指纹**已刷新**：`main.js` 与 `styles.css` 因本轮改动变化（`main.js` → `4c6215d9f406cbb8...`，`styles.css` → `ff1c43208931a106...`），`sourceCommit` 更新为 `7a42e93e4d4c0897c7b1d2c968363522f741861a`。**语义提醒**：刷新之后该文件描述的是「分支当前构建」，也**不再**等于已发布 `2.0.6` 的资产 —— 已发布资产的权威哈希记录在 `docs/releases/release-ledger.json`。在 release-captain 给出新版本号之前，谁都不应据 `release-info.json` 发布。仓库内仍**没有**生成/校验该文件的脚本（`verify-osyc-release.mjs` 与 `verify-osyc-collaboration.mjs` 都不读它），完全靠人工维护。
- 本轮改动**未**在 `docs/plans/` 下先立设计文档，而是直接以本变更记录 + `docs/handoff/2026-09-16-osyc-chatgpt-layout-and-icon-unification.md` 作为设计说明；如需长期维护版式契约，建议补一篇 `docs/plans/osyc-chat-surface-2026-09-16.md`。

## Integration request

合并源码、测试与 `styles.css`/`main.js` 的重建产物，并接受 `release-info.json` 的指纹刷新。**不要**为本改动复用 `2.0.6`：该版本已发布且不可移动。下一个补丁版本号、以及是否与后端 `stable206` 门槛一起下发，均由 release-captain 决定。
