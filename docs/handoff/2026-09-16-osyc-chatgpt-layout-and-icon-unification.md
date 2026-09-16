# OsyC Agent Handoff: 对话页 ChatGPT 版式与图标统一

- **From**: `codex`
- **To**: `release-captain / next UI agent`
- **Date**: `2026-09-16`
- **Branch and commit**: `codex/2.0.6-stabilize` @ `7a42e93e4d4c0897c7b1d2c968363522f741861a`（本轮代码提交；文档与指纹提交紧随其后）
- **Change record**: `docs/changes/codex-2026-09-16-osyc-chatgpt-layout-and-icon-unification.md`
- **Version reservation**: `2.0.7` —— 维护者 2026-09-16 授权作为预览版下发（`2.0.6` 已消耗，tag 不可移动）
- **Related design**: `docs/plans/osyc-chat-surface-2026-09-16.md`（界面契约）、`docs/plans/osyc-2.0.7-build-2026-09-16.md`（施工与进度）

## Completed

- 对话页改造为 ChatGPT 式版式：侧栏（新会话 / 分组会话列表 / 底部动作）、顶栏（折叠开关 / 移动端菜单 / 公告 / 账户条）、消息区、胶囊输入区。
- 会话列表按 今天 / 昨天 / 前 7 天 / 更早 分组，边界按本地日历日计算（`sessionList.ts`，5 条单测）。
- 侧栏在 `>720px` 可折叠为 56px 图标栏，折叠状态按 Vault 持久化（`osycPanePreferences.ts`）；`<=720px` 仍为抽屉 + 遮罩。
- 输入框随草稿自动增高，上限 180px 后内部滚动；发送键改为圆形图标按钮。
- 用户气泡恢复中性底色 —— 此前 `appearance.ts` 用 `!important` 把气泡强制涂成强调色。
- 新增 `OsycIcon.svelte`，六个界面（对话页 / 助手气泡 / 工具中心 / 账户弹窗 / 公告 / 原生设置页）统一改用 Obsidian 内置图标，共 27 个图标名。
- 修掉两个此前一直存在的静默样式缺陷：会话状态图标的 class 挂在子组件上（Svelte 作用域样式够不到）、OC 头像样式写在 pane 作用域里而元素属于另一个组件。
- 新增图标卫生门禁：白名单校验图标名 + 5 个界面禁用 Unicode 图标字形（设置页因 `addPane` emoji 约定豁免）。

## Verification evidence

```text
npm run test:unit -- src/osyc/features/AIAgent
→ Test Files 20 passed (20) / Tests 196 passed (196)

npm run check
→ tsc 0 errors; eslint 0 errors (9 条既有警告); community lint 通过;
  svelte-check found 0 errors and 0 warnings;
  check:compatibility --ios 15 → Compatibility Check Passed

图标名核对（一次性，非仓库脚本）
→ 从本机 C:\Users\Y2516\AppData\Roaming\obsidian\obsidian-1.13.7.asar
  抽出内置图标表 1994 个 id，OsyC 用到的 27 个名字全部命中

npm run svelte-check（单独）
→ svelte-check found 0 errors and 0 warnings
```

## Remaining work

1. ~~版本号~~ **已完成**：`2.0.7` 已于 2026-09-16 作为 GitHub 预发布发布（tag @ `1fc9006`，target 同为该提交，三资产 sha256 与本地一致）。完整施工记录见 `docs/plans/osyc-2.0.7-build-2026-09-16.md`。
2. **真机回归**（仅用户主观验收过，无截图）：
   - 侧栏折叠 → 重开 Obsidian → 是否仍折叠（持久化路径只做了单测级验证）；
   - 移动端抽屉手势、遮罩点击、安全区；
   - 会话分组在真实任务历史下的观感（目前单测只覆盖边界算法）。
3. **发布准备**（在拿到版本号之后）：`npm run check` 会重建 `main.js`，需重新刷 `release-info.json`（`sourceCommit` 指向本次代码提交 `7a42e93`，本轮已刷），再按既有流程推送 `main` 触发 `publish-release-assets.yml`。
4. **可选清理**：`AIAgentTaskCard.svelte` 仍未挂载，内含 emoji 状态图标。清理它要同时改 `brandCopy.unit.spec.ts`、`AIAgentTaskCard.unit.spec.ts`、`AIAgentPane.mobile.unit.spec.ts` 与一篇历史变更记录。
5. **可选补文档**：本轮未先立 `docs/plans/` 设计文档，若要长期维护版式契约，建议补一篇 `docs/plans/osyc-chat-surface-2026-09-16.md`（把 `.ai-*` 契约、180px 上限、断点 720px 写进去）。
6. **本机 git ref 缺陷已在 2.0.7 施工中复发并结构性规避**：本仓库的分支 ref 实际存于 `packed-refs`，其值停在 `0a7dd4d`（落后 3 个提交），新提交对象 `607bd4c` 与 reflog 都正常但 loose ref 未落盘，`HEAD` 因此回退到旧提交。已写回 loose ref 修复，并把工作分支切到**扁平名** `codex-2.0.6-stabilize`（扁平 ref 实测可写）；嵌套的 `codex/2.0.6-stabilize` 保留为归档、不再提交。今后对 `codex/*` 命名一律避免。
7. **GitHub `latest` 指针异常（待确认）**：`GET /releases/latest` 返回 `2.0.0`，而 `2.0.4` 更新且非预发布 —— 意味着 BRAT 的稳定（非 beta）通道可能装到 `2.0.0`。需真机确认后把 latest 重新指向 `2.0.4`（需要凭据，release-captain 操作），或改为按显式版本安装。

## Do not change

- `2.0.4`（稳定版）与 `2.0.6`（预发布）的 tag、GitHub Release、资产哈希：`2.0.6` tag 指向 `0a7dd4d`，本改动**不得**复用该版本号或移动该 tag。
- 正式服务器 `/srv/osyc/releases/*` 与后端兼容范围：本改动是纯插件 UI，不涉及后端契约。
- `addPane` 的 emoji 分组标题：属于 LiveSync 全局约定。
- 既有 Emoji/磁盘/同步等无关功能：本轮只动 `src/osyc/features/AIAgent/**` 的展示层与 `styles.css`。

## Integration notes

- 合并顺序：先合代码提交（`7a42e93`），再合文档 + `release-info.json` 指纹提交。
- `styles.css` 与 `main.js` 都被跟踪，`npm run check` 会重建 `main.js`；合并后如需再次校验，重跑 `npm run check` 并确认 `release-info.json` 里 `main.js` 的 sha256 与工作区一致（本轮为 `4c6215d9f406cbb8`）。
- 新增图标前请先确认名字在本机 Obsidian 内置图标表内，再追加进 `reviewHygiene.unit.spec.ts` 的 `OSYC_ICON_VOCABULARY`；拼错的名字不会报错、只会渲染成空白。
