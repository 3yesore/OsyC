# OsyC 对话界面设计（ChatGPT 版式）· 2026-09-16

> 本文是 `.ai-*` 对话界面的**稳定契约**，描述已经落地并受测试保护的设计，不记录施工顺序。
> 施工顺序、进度与证据见 `docs/plans/osyc-2.0.7-build-2026-09-16.md`；
> 本轮改动的事后记录见 `docs/changes/codex-2026-09-16-osyc-chatgpt-layout-and-icon-unification.md`。
> 上游设计中本文件取代 `docs/plans/osyc-settings-account-ui-2026-09-11.md` 第 3 步中与对话页版式相关的部分。

## 1. 目标与非目标

**目标**

1. 对话页的观感与操作节奏对齐 ChatGPT：左侧会话历史、中间单一阅读列、底部会增高的输入框。
2. 侧边栏必须能**收起**，把宽度还给正文（移动端则是抽屉，不挤占正文）。
3. 界面内所有图标统一为 Obsidian 内置图标，跟随主题色、跨平台字体一致。

**非目标**

- 不改动消息的数据模型、任务生命周期、后端协议与同步行为。
- 不改动 `addPane` 的 emoji 分组标题（LiveSync 全插件通用约定）。
- 不追求与 ChatGPT 逐像素一致；只对齐「信息层级 + 交互习惯」。

## 2. 信息架构

```
.ai-pane.osyc-ai-agent
└─ .ai-shell                       ← 栅格：侧栏 | 正文
   ├─ aside.ai-sidebar             ← 会话记录
   │  ├─ .ai-sidebar-head          ← 新会话按钮（移动端另有关闭按钮）
   │  ├─ nav.ai-session-list       ← 「全部会话」+ 按时间分组的会话项
   │  └─ .ai-sidebar-actions       ← 工具中心 / 清理记录 / 退出账户
   ├─ button.ai-sidebar-scrim      ← 仅移动端抽屉打开时存在
   └─ main.ai-chat
      ├─ header.ai-chat-header     ← 折叠开关 | 标题+模型 | 公告 | 工具中心 | 账户条
      ├─ .ai-banner                ← 演示模式提示（条件渲染）
      ├─ .ai-chat-timeline         ← 唯一滚动容器
      │  ├─ .ai-welcome / .ai-activation / .ai-suggestion（条件渲染）
      │  └─ .ai-conversation       ← 消息列，max-width: var(--ai-chat-column)
      └─ section.ai-composer       ← 固定不滚
         └─ .ai-composer-box > textarea.ai-composer-input + .ai-send-btn
```

三条**不可破坏**的布局约束（由 `AIAgentPane.mobile.unit.spec.ts` 断言）：

| 约束 | 原因 |
| --- | --- |
| `.ai-chat { height: 100%; }` | 移动端无键盘时聊天区必须填满页面 |
| `.ai-composer { flex: 0 0 auto;` | 输入框固定在底部，不参与滚动 |
| `.ai-chat-timeline` 是唯一滚动容器 | 宿主容器不参与滚动，规避 iOS 键盘视口抖动 |

同时**禁止**出现 `position: sticky`、`window.visualViewport`、`--ai-viewport-height`、`getBoundingClientRect().top`、`--osyc-ai-bottom-inset`、`host.style.height` 等键盘补偿写法 —— 这些是上一代实现被废弃的原因。

## 3. 栅格与断点

| 断点 | 栅格 | 侧栏形态 |
| --- | --- | --- |
| `> 720px` | `grid-template-columns: minmax(232px, 24%) minmax(0, 1fr)` | 常驻；`ai-sidebar-collapsed` 时收成 `56px`，隐藏 `.ai-session-list` 与所有 `.ai-control-label`，仅留图标 |
| `<= 720px` | `display: block` + 绝对定位 | 抽屉：`width: min(86vw, 320px)`，`translateX(-102%)` → 打开时归位，配 `.ai-sidebar-scrim` 遮罩；`.ai-sidebar-toggle` 隐藏，改用 `.ai-mobile-menu` |

- 折叠状态只影响 `> 720px`；移动端永远从「收起」开始，避免一进页面就被抽屉挡住正文。
- `--ai-chat-column: 768px` 定义在 `.ai-pane` 上，正文列宽随该变量走。

## 4. 会话列表

### 4.1 分组规则（`sessionList.ts`）

- 四档：`今天 / 昨天 / 前 7 天 / 更早`。
- 边界按**本地日历日**计算（`startOfLocalDay`），天数差用 `Math.round` 归一 —— 用 24 小时窗口会在夏令时切换当天错档。
- 分组由新到旧；**空分组不渲染**；组内会话由新到旧。
- 「全部会话」固定在列表顶部，不属于任何分组。

### 4.2 单项结构

```html
<button class="ai-session-item" class:active>
  <span class="ai-session-status ai-session-status-{status}"><OsycIcon … /></span>
  <span class="ai-session-label">{摘要}</span>
</button>
```

⚠️ **状态色必须由外层 `span` 承载**。Svelte 的作用域样式无法作用于子组件内部元素；早期版本把 class 直接挂在 `OsycIcon` 上，样式静默失效（不报错、只是没有颜色）。

### 4.3 状态 → 图标 → 颜色

| 状态 | 图标 | 颜色 |
| --- | --- | --- |
| `queued` | `clock` | `--text-faint` |
| `running` | `loader` | `--interactive-accent` + 1.4s 旋转（`prefers-reduced-motion` 下停用） |
| `done` | `check` | `--color-green` |
| `failed` / `conflict` / `delivery_failed` | `alert-triangle` | `--color-red` |
| `awaiting_confirmation` | `info` | `--color-orange` |
| `interrupted` | `pause` | 默认 |
| `failed_zero_cost` / `cancelled` | `x` | 默认 |

## 5. 输入区

- 形态：胶囊（`border-radius: 22px`），`max-width: var(--ai-chat-column)`。
- 自动增高：`$effect` 里 `element.style.height = min(scrollHeight, 180)px`，`COMPOSER_MAX_HEIGHT = 180` 与 CSS `max-height: 180px` 必须同时改（当前靠注释维持一致，没有测试绑定）。
- 空输入时发送键 `disabled`；`Enter` 发送、`Shift+Enter` 换行。
- 底部留白用 `max(10px, env(safe-area-inset-bottom))`，不做任何 JS 视口补偿。

## 6. 颜色分层

| 层 | 变量 | 说明 |
| --- | --- | --- |
| 对话区 | `--osyc-ai-surface` | 正文底 |
| 侧栏 / 用户气泡 / 输入框 | `--osyc-ai-surface-alt` | 比正文低一档的中性底色 |
| 边框 | `--osyc-ai-border` | 用户气泡描边、输入框描边 |

**用户气泡是中性色，不是强调色**。`appearance.ts` 的 `agentThemeAdapterCss` 曾用 `!important` 把气泡强制染成 accent 色，与 ChatGPT 的观感相反；现已改为 `surface-alt` + 描边 + 正文色。用户自定义外观仍然生效（该适配层的 `!important` 保留，只是取值换了）。

## 7. 图标规范

- 组件：`OsycIcon.svelte` —— `$effect` 中先 `element.replaceChildren()` 再 `setIcon()`；Obsidian 的 `setIcon` 是**追加**语义，不清理会重复渲染。
- 尺寸通过 `--osyc-icon-size` 传入；`class` 必须落在**本组件自己的元素**上，不能指望父组件作用域样式穿透。
- 名称必须是 Obsidian 内置图标。**未知名称不报错、只渲染成空白** → 白名单（`OSYC_ICON_VOCABULARY`，当前 27 个）是唯一的防线；新增图标必须先比对本机 obsidian asar 的内置图标表（1.13.7 共 1994 个 id）。
- emoji / Unicode 字形禁令覆盖 5 个界面文件；设置页因 `addPane` 约定豁免。

## 8. 持久化

| 键 | 位置 | 写入时机 |
| --- | --- | --- |
| `osyc-pane-sidebar-collapsed` | Obsidian per-vault local storage（`app.saveLocalStorage`） | 点折叠/展开按钮时 |

- 走 `osycPanePreferences.ts`，用 `requireApiVersion("1.8.7")` 兜底，低版本静默降级为「不记忆」。
- **不写入** `<vault>/.obsidian/livesync-aiagent.json`，避免把纯 UI 偏好卷进同步。

## 9. 验收标准

1. `> 720px`：折叠后侧栏恰为 56px、正文变宽、会话列表消失、按钮只剩图标；重开面板后仍是折叠态。
2. `<= 720px`：点击菜单出抽屉 + 遮罩，点遮罩或关闭按钮收回；正文宽度不受抽屉影响。
3. 会话列表按四档分组，空分组不出现，组内最新在前。
4. 输入框从 1 行随草稿增高，超过 180px 内部滚动，不再长高。
5. 所有状态图标可见且有颜色区分；无任何 emoji 顶替图标。
6. 上述 1–5 在**明暗主题**下都成立（颜色全部走主题变量，不写死）。
7. 门禁：`npm run check` 全绿 + AIAgent 目录单测全过。

## 10. 待讨论 / 后续可选项

- **侧栏语义**：当前是「会话记录 + 新会话 + 底部动作」。若要更贴近 ChatGPT，还可考虑：置顶/重命名会话、按项目分组、搜索框、侧栏内折叠到「仅图标」之外的第二种形态（如 hover 悬浮展开）。
- 移动端抽屉是否改成左右滑动（`touchmove`）关闭 —— 目前只支持点遮罩与关闭按钮。
- 180px 上限与断点 720px 是否要变成用户可配置项。
- 死代码 `AIAgentTaskCard.svelte` 仍含 emoji 状态图标且未挂载，清理它需要同时改 3 个测试文件与 1 篇历史变更记录。
