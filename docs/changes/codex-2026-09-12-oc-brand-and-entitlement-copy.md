# Change Record: OC 品牌文案与权益摘要清理

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/design/README.md`
- **Version reservation**: `1.0.77`
- **Status**: `ready for integration`

## Intent

统一 OsyC 插件内的用户可见品牌为 `OC`，并从账户权益摘要中移除人民币等值模型额度展示。服务端额度字段、客户端状态字段和实际计费链路保留不变，仅调整展示层，避免影响额度核算与兼容性。

## Files changed

- `src/osyc/features/AIAgent/AIAgentFloating.ts`: 悬浮球文字和无障碍标签改为 OC。
- `src/osyc/features/AIAgent/AIAgentPaneView.ts`: 工作区页面标题、显示名和失败提示改为 OC。
- `src/osyc/serviceFeatures/useAIAgentUI.ts`: Ribbon、命令面板、交互设置和打开失败提示改为 OC。
- `src/osyc/features/AIAgent/AIAgentPane.svelte`: 激活入口改为 OC 品牌文案。
- `src/osyc/features/AIAgent/AIAgentTaskCard.svelte`: 回复区域标签改为 OC。
- `src/osyc/features/AIAgent/AIAgentAccountModal.ts`: 技能/整理任务文案改为 OC，删除人民币等值额度两处展示。
- `src/osyc/features/AIAgent/*.unit.spec.ts`, `src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts`: 增加品牌和权益展示回归断言。

## Behaviour and compatibility

- 内部 `AIAgent` 类型、视图 ID、CSS 类名、后端 `model_quota`/`credits_yuan` 字段均保持兼容。
- 账户页继续显示积分、档位、设备、同步和 Cloud-Vault 权益；不再显示 `¥... 元等值` 或“模型额度赠送”。
- `1.0.76` 已发布 tag/Release 不修改；本记录对应不可变 `1.0.77` 测试包。

## Verification

```text
npm run test:unit -- --run src/osyc/features/AIAgent src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts
npm run tsc-check
npm run svelte-check
npm run build
npm run check:compatibility
node utils/verify-osyc-release.mjs
```

- Result: `14 files passed, 165 tests passed; tsc 0; svelte-check 0 errors/0 warnings; production build 0; iOS 15 compatibility passed; release contract aligned 1.0.77`.
- Device or environment: `Windows local unit suite`

## Known gaps

- 手机端 BRAT 真机验收需由维护者执行；远端 Release `1.0.77` 已为 pre-release，五资产哈希已核对。

## Integration request

合并本变更记录和源码改动；发布流程使用预留的 `1.0.77`，保持 `1.0.76` 不可变。
