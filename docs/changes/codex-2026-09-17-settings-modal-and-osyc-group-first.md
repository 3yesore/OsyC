# Change Record: 设置入口改为原生弹窗 + OsyC 分组提前

- **Agent**: `codex`
- **Date**: `2026-09-17`
- **Branch**: `codex-2.0.6-stabilize`
- **Related design**: `docs/changes/codex-2026-09-16-osyc-native-settings-page.md`, `docs/changes/codex-2026-09-17-settings-jump-and-colour-preset.md`（后者修好了 `openTabById` 的调用方式，但用户真机验收仍认为「设置跳转还是有问题」）
- **Version reservation**: `2.0.9`
- **Status**: `published as the OsyC 2.0.9 GitHub pre-release`（2026-09-17；真机验收待用户确认）

## Intent

用户真机验收 2.0.8 后的反馈：「设置跳转还是有问题。我的想法是**直接用 Obsidian 原生弹窗来呈现设置页**，同时再把 **OsyC 排第一**。」

这两条是同一个问题的两种解法，本轮都做：

1. **插件内的「设置」入口不再进 Obsidian 设置窗口**，改为打开一个 Obsidian 原生 `Modal` 承载 OsyC 偏好设置。
2. **原生设置页里 `🧠 OsyC` 根分组提到第一位**，供仍然走原生路径的用户。

## Root cause（为什么修了 `openTabById` 还是不好用）

2.0.8 把 `openObsidianSettings()` 修成只调 `openTabById(CURRENT_PLUGIN_ID)`，消除了「先渲染在上一个 tab」的闪烁，也能可靠落到本插件的设置页。但**落到本插件设置页之后，看到的是分组列表**：

```
🧙 Quick Setup
🔄 Synchronisation
🧠 OsyC          ← 用户要找的东西在第三个
⚙️ General Settings
```

用户点「设置」的预期是**看到设置项本身**，而不是再点一次。这一层无法靠 `openTabById` 消除 —— 它只能定位到「插件的设置页」，而**设置分组在 Obsidian 声明式设置里没有 id**（`ObsidianLiveSyncSettingTab.createRootGroup()` 返回的对象只有 `heading`，见 `ObsidianLiveSyncSettingTab.ts:823-835`），没有可深链的目标。

所以正解是**不经过设置窗口**：用原生 `Modal` 直接渲染 OsyC 的设置内容。

## Files changed

- **`src/osyc/features/AIAgent/OsycSettingsModal.ts`（新增）**：
  - `OsycSettingsModal extends Modal`，`onOpen()` 里把 `OsyC 设置` 写进 `titleEl`，并把**原生设置页的同一份渲染**装进 `contentEl`。
  - `contentEl.addClass("sls-setting")` —— 复用原生设置页的排版基线与移动端控件尺寸规则，避免弹窗里出现第二套排版。
  - 自带 `addPane` / `addPanel` 垫片：形状与 `ObsidianLiveSyncSettingTab` 声明式分支里的实现一致（`new Setting(el).setName(title).setHeading().setClass("sls-setting-pane-title")` + 微任务延迟），因此设置项在弹窗与原生页里长得一样。
  - 底部保留一个**明确标注**的二级入口「同步配置（LiveSync）」→ `openObsidianSettings(app, CURRENT_PLUGIN_ID)`。理由：远端地址、口令、数据库结构属于 LiveSync，OsyC 设置里放不下，不能因为改成弹窗就让这条能力消失。
  - 导出 `openOsycSettings(app)` 作为唯一入口函数。
- **`src/osyc/features/AIAgent/osycSettingsPane.ts`**：新增 `renderOsycSettingsPanes(paneEl, functions)`，供原生页与弹窗共用。`paneOsyc` 的 `this` 只为满足 `SettingsPaneRenderer` 签名（函数体开头就 `void this;`），因此这里直接调用，**不复制渲染逻辑** —— 两套设置界面各持一份状态互相覆盖，正是上一版自建设置弹窗被删除的原因。
- **`src/modules/features/ModuleObsidianSettingTab.ts`**：`openSetting()`（`EVENT_REQUEST_OPEN_SETTINGS` 的处理器）改为 `openOsycSettings(this.app)`；不再需要 `openObsidianSettings` / `CURRENT_PLUGIN_ID` 的 import。
- **`src/osyc/features/AIAgent/AIAgentToolsModal.ts`**：工具中心「OsyC 设置 → 打开设置」改为**先 `this.close()` 再开设置弹窗**（避免两个弹窗叠加），并在按钮描述里说明弹窗内容。
- **`src/osyc/features/AIAgent/AIAgentAccountModal.ts`**：「同步设置 → 打开」同样改为弹窗；描述改为「打开 OsyC 设置弹窗；远端地址与口令属于 LiveSync，在弹窗底部的原生设置入口调整」。
- **`src/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts`**：`getSettingDefinitions()` 两个分支都把 `osyc` 提到 `pendingInitialisation` 之后的**第一个分组**（未配置分支原来是 `quickSetup → synchronisation → osyc`，配置分支是 `synchronisation → osyc`）。注释写明理由：插件内入口已收敛到弹窗，走原生设置页的用户多半是主动来找自己的偏好，LiveSync 的首次配置引导保持原顺序紧随其后。
- **`styles.css`**：新增 `.osyc-settings-modal`（宽度 `min(640px, 100vw - 32px)`、`modal-content` 限高滚动）、`.osyc-settings-modal-footer`（分隔线用 `var(--background-modifier-border)`，间距用 Obsidian 的 `--size-4-*` 变量）、以及移动端两条覆盖。**未引入硬编码颜色**。
- **`src/osyc/features/AIAgent/OsycSettingsModal.unit.spec.ts`（新增）**：5 条断言 —— 是原生 `Modal` 且渲染共用实现；弹窗自己**不得**再实现一份设置项渲染（反向断言 `appearanceToCssVariables` / `getOsycSettingsController` / `setServiceUrl` 都不出现）；三个入口都走 `openOsycSettings(this.app)` 且都不再引用 `openObsidianSettings`；LiveSync 专属配置仍可达；弹窗不持有第二份设置状态（无 `loadData`/`saveData`）。
- **`src/osyc/features/AIAgent/reviewHygiene.unit.spec.ts`**：把 `OsycSettingsModal.ts` 纳入 `OSYC_ICON_SURFACES` —— 它自己画一个图标（`settings`），因此同时受「必须走 Obsidian 图标集」与「图标名必须在白名单词汇表内」两条约束。
- **`src/modules/features/ModuleObsidianSettingTab.unit.spec.ts`**：新增 `vi.mock("@/osyc/features/AIAgent/OsycSettingsModal")`，并新增一条入口回归断言（`EVENT_REQUEST_OPEN_SETTINGS` 的处理器调用 `openOsycSettings(this.app)`）。mock 是**必须**的：`vitest.config.unit.ts` 把 `obsidian` 别名成空串（防止单测误引运行时），而弹窗是**值导入**、会经 `@/deps.ts` 拉到 `obsidian`，不 mock 会让整份 spec 在解析阶段以 `specifiers must be a non-empty string` 失败。
- **顺序断言同步更新**：`ObsidianLiveSyncSettingTab.declarative.unit.spec.ts` 里三处断言（`slice(0,4)`、`slice(0,5)`、整表 9 项）与 `definitions[0].heading` 全部改为 `🧠 OsyC` 在首位，并改掉原来那句「OsyC 自身的设置排在同步之后，既不抢首次配置的引导位」的注释。

## Verification

- **`npm run check`（tsc-check / tsc-check:apps / lint / lint:community / svelte-check / check:compatibility）全绿**：tsc 0 错、eslint **0 错 / 9 条既有警告**、svelte-check **0 错 0 警**、iOS 15 兼容检查通过（`main.js` 未使用 Class Static Block / RegExp Lookbehind / RegExp Unicode (v)）。
  - 中途被 lint 挡过一次：`renderOsycSettingsPanes()` 里写的 `paneOsyc as unknown as (...)` 触发 `@typescript-eslint/no-unnecessary-type-assertion` —— 断言确实多余（`this` 参数不影响该函数到 `(paneEl, functions) => void` 的可赋值性）。已改为「**共享实现为主 + `paneOsyc` 薄适配层**」，零 cast。
- **单元测试**：`vitest run --config vitest.config.unit.ts src` —— **120 个文件全过**。
  - 新增 `OsycSettingsModal.unit.spec.ts`（5 条：原生 Modal + 共用实现 / 不复制设置项渲染 / 三个入口统一 / LiveSync 配置仍可达 / 不持有第二份状态）。
  - `ObsidianLiveSyncSettingTab.declarative.unit.spec.ts`：三处顺序断言与首项断言改为 `🧠 OsyC` 在首位。
  - `ModuleObsidianSettingTab.unit.spec.ts`：新增入口回归断言，并**必须** `vi.mock` 弹窗模块 —— `vitest.config.unit.ts` 把 `obsidian` 别名成空串，而弹窗是值导入、会经 `@/deps.ts` 拉到 obsidian 运行时，不 mock 会让整份 spec 在解析阶段以 `specifiers must be a non-empty string` 失败。
- **发布契约校验**：`verify-osyc-release.mjs` → `OsyC release contract aligned: 2.0.9`；`verify-osyc-collaboration.mjs` → exit 0（`OsyC collaboration state aligned: 2.0.4`）。
- **未覆盖 / 需要真机验收**：
  1. 弹窗在真机上的版面（`width: min(640px, calc(100vw - 32px))`、移动端 `max-height`）与设置项排版是否与原生设置页一致。
  2. 原生设置页里 `🧠 OsyC` 是否确实排在第一位（桌面端与移动端）。
  3. 工具中心 / 账户弹窗点「设置」后是否**只**出现设置弹窗（不再有原生设置窗口闪现）。
  4. 我本机未安装 Obsidian，以上三条只能靠代码与单测覆盖，必须要真机确认。

## Not changed on purpose

- `src/common/obsidianSettings.ts` **保留** `openObsidianSettings()`：原生设置页仍是 Obsidian 侧的正规入口，且设置弹窗底部需要它作为 LiveSync 同步配置的跳板。它不再被任何插件内「设置」按钮直接使用。
- 没有把 `EVENT_REQUEST_OPEN_SETTINGS` 的语义改成「打开原生设置」：该事件的既有语义就是「打开设置」，而产品上的设置入口已统一为弹窗。
