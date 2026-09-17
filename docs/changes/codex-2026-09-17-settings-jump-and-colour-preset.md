# Change Record: 设置跳转直达 + 配色预设不再被排版预设污染

- **Agent**: `codex`
- **Date**: `2026-09-17`
- **Branch**: `codex-2.0.6-stabilize`
- **Related design**: `docs/changes/codex-2026-09-16-osyc-native-settings-page.md`, `docs/changes/codex-2026-09-12-sync-font-theme-fix.md`
- **Version reservation**: `2.0.8`（2.0.7 已作为预发布发出，本轮修复走下一个补丁版本）
- **Status**: `fixed locally, awaiting device acceptance`（单元测试通过；真机验收待用户在 Obsidian 上确认）

## Intent

修掉用户报的两个 2.0.7 表现问题：

1. **设置跳转不直达**：从插件里点「设置 / 同步设置」会先跳到 Obsidian 原生设置页，而且有的入口根本到不了目标页。
2. **UI 基线不一致**：同一套界面在不同条件下表现不同，用户怀疑是主题导致。实际根因不是主题，而是**外观设置里的排版预设把配色预设覆盖了**。

## Root causes

### 1. 设置跳转

`src/common/obsidianSettings.ts` 的 `openObsidianSettings()` 先 `setting.open()` 再 `setting.openTabById(tabId)`。

- `open()` 会把设置窗口渲染在**上一次打开的那个 tab** 上，随后 `openTabById()` 才切走 —— 那一帧就是用户看到的「中途跳到 Obsidian 原生设置」。
- 更严重的是 **tab id 传错了**：`AIAgentAccountModal.ts` 传的是 `"synchronisation"`。那是 LiveSync 通过 `getSettingDefinitions()` 声明的**设置分组**，而 `ObsidianLiveSyncSettingTab.createRootGroup()` 返回的对象里**只有 `heading` 没有 `id`**（`ObsidianLiveSyncSettingTab.ts:823-835`），Obsidian 无从匹配。于是 `openTabById("synchronisation")` 静默失败，`open()` 却已经把窗口打开了 → 用户被留在原生设置页。
  - 对照：`AIAgentToolsModal.ts:115` 用的是 `CURRENT_PLUGIN_ID`（`"osyc"`），这是插件的合法 tab id，所以那个入口能到，但同样会闪一下。

### 2. UI 基线不一致

配色与排版**共用一套 preset 名字**（`theme / mist / graphite / … / chinese-writing`），但语义分家：

- `appearanceToCssVariables()`：**只在 `effective.colourPreset !== "theme"` 时**才从 `PRESET_COLOURS` / `DARK_PRESET_COLOURS` 取硬编码配色（`appearance.ts:425-426`）；排版则走 `CURATED_PRESET_DEFAULTS[preset] ?? […colourPreset]`（`appearance.ts:407`）。
- 所以 `colourPreset === "theme"` ⇒ 不注入任何颜色变量 ⇒ CSS 兜底（`.osyc-ai-agent` 上那 30 个变量）生效 ⇒ **跟着主题走**，也就是用户认为「表现最好」的那一版。
- 但 `themeModel.ts` 的 `toAppearance()` 写的是 `colourPreset: profile.preset` —— 把**排版预设**塞进了**配色字段**。实际生效的注入路径正是这条往返（`useAIAgentUI.ts:282` 的 `applyThemeProfileStyles()`，用的是 `setCssProps()` **内联**样式，优先级高于任何 CSS 规则）。
- 结果：用户只要选过任何非 `theme` 的排版预设（例如「中文写作」想换字体），就会被**意外套上一整套硬编码配色**（chinese-writing 的 `#fbf7ef` 米色底 / `#332c27` 深棕字），在深色主题下尤其突兀 —— 看起来像「另一套基线 / 不跟主题」。

## Files changed

- `src/common/obsidianSettings.ts`：`openObsidianSettings()` 改为**直接** `openTabById(tabId)`，不再先 `open()`；新增 `SETTINGS_HOST_SELECTOR` 与一个 `queueMicrotask` 兜底（仅当设置窗口确实没打开时才补一次 `open()`，已在浏览器里可见时绝不重开，避免重新引入闪烁）。注释里写明**不接受分组 id** 及原因。缺 `openTabById` 的老 build 仍回退到 `open()`。
- `src/osyc/features/AIAgent/AIAgentAccountModal.ts`：`"synchronisation"` → `CURRENT_PLUGIN_ID`；补 `CURRENT_PLUGIN_ID` 的 import；按钮描述改为「打开 Obsidian 设置里的 OsyC 页面，在 Synchronisation 分组中查看和调整同步配置」（原来承诺直达 Synchronisation 页，而这是做不到的）。
- `src/osyc/features/AIAgent/AIAgentAccountModal.unit.spec.ts`：断言改为要求传 `CURRENT_PLUGIN_ID`，并**反向断言**不得再出现 `"synchronisation"`。
- `src/osyc/theme/themeModel.ts`：
  - `ThemeProfile` 新增可选字段 `colourPreset`（注释说明为何与 `preset` 分开、为何可选）。
  - `profileFromAppearance()` 保留 `appearance.colourPreset`。
  - `toAppearance()` 改为 `colourPreset: profile.colourPreset ?? profile.preset`。
  - `parseThemeProfile()` 读取 `value.colourPreset ?? value.preset` —— 关键：**拆分之前写下的 profile 没有这个字段**，回退到 `preset` 可以保持历史行为，不会把老用户的配色静默重置成「跟主题」。
- `src/osyc/theme/themeModel.unit.spec.ts`：新增 2 条回归断言 —— ①排版预设不再带来配色覆盖（`colourPreset: "theme"` 时不产出 `--osyc-ai-text`；`colourPreset: "chinese-writing"` 时才产出 `#332c27`）；②v2 老 profile 仍按 `preset` 解析出配色（`graphite` → `#202326`）。

## Verification

- **单元测试**：`vitest run --config vitest.config.unit.ts src/osyc/theme src/osyc/features/AIAgent src/modules/features src/common` —— 通过（含新增 2 条断言与既有的分组顺序断言；分组顺序未改动，`OsyC` 仍排在同步分组之后）。
- **未改动**：`styles.css`、`AIAgentPane.svelte`、`useAIAgentUI.ts` 一字未动 —— 本轮只修「变量喂错值」和「跳转喂错 id」。
- **未覆盖 / 需要真机验收**：
  1. `openTabById()` 是否在用户的 Obsidian 版本上**自己**打开设置窗口（我本机没装 Obsidian，无法验证；代码里留了 `queueMicrotask` 兜底，最坏情况退化为「先 open 再切」，即旧行为）。
  2. 用户改过外观设置的设备上，配色是否回到「跟主题」。
  3. 深链到某个**设置分组**（例如直接落在 Synchronisation 分组）当前**做不到** —— 分组在 Obsidian 声明式设置里没有 id。如产品上必须要，需要另设机制（例如在 OsyC 设置页内提供同步摘要，或改分组顺序，后者会与既有设计意图「OsyC 不抢首配引导位」冲突）。

## Not changed on purpose

- 根分组顺序：`ObsidianLiveSyncSettingTab.declarative.unit.spec.ts:216-242` 断言 `Quick Setup → Synchronisation → 🧠 OsyC → General Settings`，且注释明确「OsyC 自身的设置排在同步之后，既不抢首次配置的引导位」。因此**没有**通过「把 OsyC 提到第一」来达成直达，而是修跳转本身。
