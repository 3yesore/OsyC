# OsyC original theme pack loader pilot

- **Agent**: `codex`
- **Date**: `2026-09-12`
- **Branch**: `codex/osyc-1.0.67-sync-entry`
- **Related design**: `docs/plans/osyc-theme-pack-loader-pilot-2026-09-12.md`
- **Version reservation**: `None`
- **Status**: `ready for integration`

## Intent

验证 OsyC 能否在插件本体内预装载原始开源 Obsidian 主题，并通过 token 选择和作用域启用。试点包含 Minimal 与 Chinese Writing Layout 两个 MIT 主题，支持完整原生工作区 CSS 和构建时生成的笔记隔离 CSS。

## Files changed

- `src/osyc/theme/themePack.ts`: 主题注册表、固定来源 commit、MIT 许可文本、主题选择、作用域 CSS 和可替换 style 节点。
- `src/osyc/theme/themePack.unit.spec.ts`: 注册表、作用域、回滚和 OsyC 样式隔离测试。
- `src/osyc/features/AIAgent/appearance.ts`: 持久化 `themePackId/themePackScope` 并安全解析白名单。
- `src/osyc/serviceFeatures/useAIAgentUI.ts`: 增加原始主题包与作用范围设置，并在外观刷新/卸载时挂载和移除主题包。
- `esbuild.config.mjs`: 构建时读取固定资源、删除远程 `@import`、生成笔记作用域 CSS，并内联到 `main.js`。
- `assets/themes/minimal/` and `assets/themes/chinese-writing/`: 原始 CSS、MIT LICENSE 和来源元数据。
- `docs/plans/osyc-theme-pack-loader-pilot-2026-09-12.md`: 试点实施边界。

## Behaviour and compatibility

- `notes` 是默认安全范围，只匹配 `.osyc-theme-notes` 内容根；`workspace` 才加载原主题的全局 CSS。
- OsyC 适配 style 节点仍独立存在，主题包节点可单独切换或移除，不会误删 OsyC 外观节点。
- 主题 CSS 固定在构建产物中，BRAT 不需要额外下载文件；许可证和来源信息随插件代码保留。
- 仅使用已核验的 MIT 项目；没有打包 GPL-3.0 的 AnuPpuccin。

## Verification

```text
npx vitest run --config vitest.config.unit.ts src/osyc
npm run tsc-check
npm run svelte-check
npm run build
npm run check:compatibility
```

- Result: `20` test files, `186` tests passed; type and Svelte checks passed; production build passed; iOS 15 compatibility passed.
- Device or environment: local Windows build; real desktop/iOS visual acceptance remains pending.

## Known gaps

- 作用域转换是构建时 CSS 选择器改写，复杂主题选择器、动画命名和插件专属设置仍需真实 Obsidian 验收。
- 原生工作区模式可能改变 Obsidian 外壳，设置页已明确提示；失败时只能通过关闭主题包回滚。
- 当前只装载两个主题，其他 MIT 候选需等试点通过后再加入。

## Integration request

请 integration agent 审阅 CSS 作用域转换和许可证记录，并在真机验收后决定是否扩展主题列表。不要 bump 版本、创建 tag 或发布 BRAT；`1.0.75` 保持不可变。
