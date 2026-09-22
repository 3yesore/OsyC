# 来源与改动说明：SmartPick 浮动工具栏骨架

本目录不是上游代码的直接副本，而是**按上游实现改写**的选择工具栏机制层。记录在此以便审计与升级对照。

| 项 | 值 |
|---|---|
| 上游 | `BCS1037/SmartPick` |
| 许可证 | MIT（`Copyright (c) 2026 BCS`，全文见同目录 `LICENSE`） |
| 固定版本 | commit `57022feaabf9aef32bf4ec8ca585de08f5c32bbb`（v0.8.7，manifest `isDesktopOnly: false`，minAppVersion 1.8.7） |
| 位置（本机） | 移植底本取自 `C:\Users\Y2516\Desktop\_port\smartpick`（临时目录，用完即删） |
| 取用文件 | `src/toolbar/Toolbar.ts`（事件与状态机）、`src/toolbar/ToolbarUI.ts`（定位与触摸守卫） |
| **不取** | 上游 `styles.css`（1068 行）、全部业务动作、AI Provider、设置页、i18n、模态框 |

## 我们改了什么（逐条）

1. **解耦宿主**：上游 `Toolbar` 直接持有 `SmartPickPlugin`（读 `plugin.settings`、`plugin.app`）。这里改为注入 `{ app, actions, onAction }`，不复用上游任何设置项、命令、业务语义。
2. **去框架**：上游 UI 层是 `ToolbarUI` 手搓 DOM（609 行）；这里换成 Svelte 组件 `SelectionToolbar.svelte`，只保留定位数学与触摸守卫。
3. **动作换成 OsyC 的**：上游工具栏动作是"选取/摘录"；这里改为 解释 / 改写 / 翻译 / 挑待办（定义在 `src/osyc/features/AIAgent/selectionToolbarActions.ts`）。
4. **去掉上游的触发开关**：上游有"修饰键触发""双击触发"两个设置；这里选择出现即弹，不加设置项（避免提交前引入 i18n/settings 依赖）。
5. **样式自写**：不移植上游 CSS，改用 Obsidian 主题变量，跟随用户主题与深浅色。
6. **接进 OsyC 生命周期**：`init()` 自己注册 `active-leaf-change`，`destroy()` 用 `workspace.offref` 摘干净，由 `useAIAgentUI` 的 unload 钩子调用。

## 逐段来源对照（保留下来的上游逻辑）

| 本目录位置 | 上游位置 | 保留下来的原因 |
|---|---|---|
| `selectionToolbar.ts` 常量 `SELECTION_TOOLBAR_DELAY_MS` / `OUTSIDE_DISMISS_GUARD_MS` | `Toolbar.ts:8-9` | 200ms 防抖 + 250ms 关闭守卫，防"同一次点击把自己又打开" |
| `attachEditorListeners()` | `Toolbar.ts:61-93` | 桌面 `mouseup/keyup/dblclick` 与移动端 `touchstart/touchmove/touchend` **分流**，以及监听 `.cm-content` 而非编辑器实例 |
| `handleTouchMove()` | `Toolbar.ts:136-144` | 8px 位移阈值：手指在滚动就不弹窗 |
| `handleDocumentSelectionChange()` | `Toolbar.ts:153-163` | 移动端走 `selectionchange`，且焦点在工具栏内时忽略 |
| `dismissAfterOutsideInteraction()` / `markToolbarInteraction()` | `Toolbar.ts:416-432` | 250ms 关闭守卫 + **iOS 点按钮触发 selectionchange 的 500ms 守卫** |
| `positionMobileToolbar()` | `ToolbarUI.ts:204-233` | 移动端不跟选区：`max(内容区顶, .view-header 底, visualViewport.offsetTop) + 8` |
| `touchGuard` 动作（Svelte） | `ToolbarUI.ts:325-361` | iOS 在默认 `touchstart` 里会清选区 ⇒ `preventDefault` + `restoreCurrentSelection()`，并抑制合成 click 双触发 |
| 容器挂在 `view.contentEl` 内 | `ToolbarUI.ts:91-98` | **关键**：定位父级是视图内容区而不是 `document.body`，所以滚动时不会漂移 |

## 我们已知仍依赖的上游行为（未改，风险自留）

- 坐标取自 `editor.cm.coordsAtPos()`（Obsidian 未公开的内部 API）。上游同样如此；一旦 Obsidian 改动该内部结构，需要同步修。
- 上游该实现**没有单元测试**，也没有第三方真机回归证据（16★）。真机验证清单见 `docs/reports/2026-09-22-mobile-selection-plugin-survey.md` §4。
