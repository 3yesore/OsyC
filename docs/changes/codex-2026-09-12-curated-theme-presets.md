# OsyC curated theme presets

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/plans/osyc-theme-rendering-fix-2026-09-11.md`
- **Version reservation**: `None`
- **Status**: `ready for integration`

## Intent

让手机和桌面端用户可以在 OsyC 设置页直接选择一组高质量、中文友好的主题预设。预设借鉴 Minimal、Things、Border、Chinese Writing Layout、Codex Style Markdown、CodeSplash Themes 和 Image Layouts 的公开设计方向，但由 OsyC 自有 token、字体和作用域 CSS 实现，安装后离线可用，不要求用户下载主题或字体。

## Files changed

- `src/osyc/features/AIAgent/appearance.ts`: 增加七个开源项目启发的预设名称、明暗配色、中文长文/代码/媒体布局默认字体与排版 token，并纳入安全解析白名单。
- `src/osyc/serviceFeatures/useAIAgentUI.ts`: 设置页外观预设下拉框改用共享 `THEME_PRESET_OPTIONS`，并显示参考来源和无远程依赖说明。
- `src/osyc/features/AIAgent/appearance.unit.spec.ts`: 验证不同预设输出不同内容 token、中文字体和代码字体。
- `src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts`: 验证设置页暴露主题预设入口。

## Behaviour and compatibility

- 旧的 `theme/mist/graphite/ocean/forest/amber/contrast` 预设保持兼容。
- 用户明确选择的字体、字号、行高、宽度和颜色覆盖仍优先于预设默认值。
- 预设只影响 OsyC 作用域和启用“应用到笔记内容”后的笔记作用域，不修改 Obsidian `appearance.json`，不自动启用 CSS 代码片段。
- 不复制 GPL-3.0 的 AnuPpuccin 代码或 CSS；不加载远程主题、远程字体或第三方运行时。

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc/serviceFeatures/useAIAgentUI.unit.spec.ts src/osyc/features/AIAgent/appearance.unit.spec.ts
```

- Result: `2` test files passed, `33` tests passed.
- Device or environment: local Windows unit test environment; real iOS/desktop visual acceptance remains pending.

## Known gaps

- 真实手机端仍需逐项验收预设切换、中文长文、代码块、图片布局和浅色/深色模式。
- 预设视觉差异由 OsyC token 表达，后续可由 integration agent 根据真机截图微调，但不得把第三方完整主题 CSS 直接引入。

## Integration request

请 integration agent 审阅预设命名、默认 token 和许可证边界，并将稳定结论合并进正式设计/施工文档。不要 bump 版本、创建 tag 或发布 BRAT；由 release captain 在真机验收后单独预留版本。
