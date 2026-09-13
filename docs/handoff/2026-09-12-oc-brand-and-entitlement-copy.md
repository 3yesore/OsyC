# OsyC Agent Handoff: OC 品牌文案与权益摘要清理

- **From**: `codex`
- **To**: `release-captain`
- **Date**: `2026-09-12`
- **Branch and commit**: `codex/osyc-1.0.67-sync-entry @ e06c7a0c75c65a45a633b1878114ee9b3b7e66a6`
- **Change record**: `docs/changes/codex-2026-09-12-oc-brand-and-entitlement-copy.md`
- **Version reservation**: `1.0.77`

## Completed

- 悬浮球、工作区入口、命令面板、激活页、任务回复和错误提示统一使用 OC 品牌。
- 权益账户摘要删除人民币等值模型额度展示，保留内部额度状态与接口字段。
- 定向品牌、账户、任务和设置回归测试已补齐。

## Verification evidence

```text
npm run test:unit -- --run src/osyc/features/AIAgent src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts
```

- `14 files passed, 165 tests passed`
- `npm run tsc-check`: passed
- `npm run svelte-check`: `0 errors, 0 warnings`
- `npm run build` and `npm run check:compatibility`: passed
- `node utils/verify-osyc-release.mjs`: `OsyC release contract aligned: 1.0.77`
- GitHub Release `1.0.77`: `prerelease=true`, five assets uploaded, remote SHA-256 matches local build.

## Remaining work

- 手机端通过 BRAT 安装 `1.0.77`，验证悬浮球/入口品牌、权益摘要和其它可见文案。

## Do not change

- 已发布的 `1.0.76` tag、Release 和五个资产。
- 稳定版 `1.0.75` 及正式服务器配置。

## Integration notes

- 版本 `1.0.77` 是本次文案清理的唯一测试包版本；不可复用或移动已有 tag。
