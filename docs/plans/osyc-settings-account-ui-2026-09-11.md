# OsyC 设置与账户权益 UI 整理计划

## 范围

- 调整 `src/osyc/features/AIAgent/AIAgentAccountModal.ts` 的账户摘要、权益、技能、设备、同步和卡密区块顺序与文案。
- 调整 `src/osyc/serviceFeatures/useAIAgentUI.ts` 的设置页信息架构，保留现有控件和即时预览能力。
- 只读使用后端下发的 `entitlements`，不在插件端复制权限判断；不触碰服务器、同步数据和卡密状态。

## 步骤

1. 在账户和设置相关单元测试中加入结构契约，先运行定向测试确认失败。
2. 重排账户页：摘要、权益总览、专属能力、设备与密钥、同步状态、卡密操作、升级提示，底部只保留关闭按钮；补充模型额度和中文技能标签。
3. 重排设置页：连接、笔记内容外观、Agent 交互、底部保存操作；为分组增加移动端可读的标题和间距，不改变现有设置回调。
4. 更新 `updates.md` 的 Unreleased 用户可见说明。
5. 运行定向 Vitest、`npm run tsc-check`、`npm run svelte-check` 和生产构建。

## 验证

工作目录：`C:/Users/Y2516/WorkBuddy/2026-08-29-19-16-25/dev/obsidian-livesync`（已废弃，见下）

```powershell
npm run test:unit -- src/osyc/features/AIAgent/AIAgentAccountModal.unit.spec.ts src/osyc/features/AIAgent/AIAgentPane.mobile.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts
npm run tsc-check
npm run svelte-check
npm run build
```

## 后续修订（2026-09-16）

第 3 步「重排设置页、保留现有控件」被取代。复核时发现 `AIAgentSettingModal` 是**死代码**：类还在，但没有任何入口实例化它，设置项在 Obsidian 里根本不可达。

改为在原生设置页承载：

- 设置项从自建弹窗迁到 `src/osyc/features/AIAgent/osycSettingsPane.ts`，以 `🧠 OsyC` 根分组插入 `ObsidianLiveSyncSettingTab`，位置在同步分组之后。
- 页面内按 `连接 / 外观 / 交互 / 诊断` 四个分组呈现；外观高频项直出，颜色与背景收进「更多颜色与背景」折叠。
- 读写经 `osycSettingsController.ts` 回到运行时，设置页不再持有第二份状态；`AIAgentSettingModal` 整体删除。
- 账户弹窗按「官方分组 + 折叠」重排，工具中心与账户弹窗明确分工（工具中心不再重复权益展示）。

完整记录见 `docs/changes/codex-2026-09-16-osyc-native-settings-page.md` 与 `docs/handoff/2026-09-16-osyc-native-settings-page.md`。

另：本计划文件中记载的工作目录 `WorkBuddy/2026-08-29-19-16-25/dev/obsidian-livesync` 已非主开发环境，当前活跃仓库为 `C:/Users/Y2516/Documents/Codex/2026-09-13/jie/worktrees/osyc-review-cleanup`。

