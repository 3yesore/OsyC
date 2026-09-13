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

工作目录：`C:/Users/Y2516/WorkBuddy/2026-08-29-19-16-25/dev/obsidian-livesync`

```powershell
npm run test:unit -- src/osyc/features/AIAgent/AIAgentAccountModal.unit.spec.ts src/osyc/features/AIAgent/AIAgentPane.mobile.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts
npm run tsc-check
npm run svelte-check
npm run build
```
