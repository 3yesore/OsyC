# OsyC 原生设置页与账户 UI 交接

记录 2026-09-16 完成的 OsyC 设置信息架构调整。本次不发布、不部署、不移动任何 tag。

## 结论

2.0.6 候选在本地已具备发布条件（`npm run check` 全绿、全量单测通过、五资产哈希自洽），但**尚未推送、尚未发布**。本轮新增的改动只影响 OsyC 自身的设置界面与账户界面，不触及同步协议、后端契约或持久化格式。

## 改动内容

### 设置：自建弹窗 → 原生设置页

| 项目 | 改动前 | 改动后 |
| --- | --- | --- |
| 承载方式 | `AIAgentSettingModal`（自建 `Modal`） | 原生设置页 `🧠 OsyC` 分组 |
| 可达性 | **无入口**（类存在但无人实例化，死代码） | 同步分组之后、通用设置之前 |
| 分组 | 19 条平铺，仅靠 `h4` 分隔 | `连接 / 外观 / 交互 / 诊断` 四个 `addPane` 分组 |
| 外观 | 快速调整 + `详细调整` 折叠 | 高频项直出，颜色与背景收进 `更多颜色与背景` 折叠 |
| 读写 | 弹窗持有一份值，`保存` 时回写 | 设置页只读快照，改动即时回写唯一运行时 |

新增文件：

- `src/osyc/features/AIAgent/osycSettingsPane.ts` — 渲染器，只消费控制器。
- `src/osyc/features/AIAgent/osycSettingsController.ts` — 桥接口 + 注册表。

被删除的死代码：`AIAgentSettingModal`（约 280 行）。它的唯一引用来自自身声明，`AIAgentToolsModal.unit.spec.ts` 里有一条断言专门防止它被重新接回。

### 账户与工具中心分工

- `AIAgentAccountModal`：改为官方分组标题 + `<details>` 折叠。首屏顺序为 概览 → 权益总览 → 同步状态；`设备与自带 Key`、`账户操作` 默认收起；新增徽章行。
- `AIAgentToolsModal`：标签由「账户与权益」改为「账户」，移除与账户弹窗重复的积分、到期时间、权益总览、OC 整理任务、私有同步、Cloud-Vault 展示，只保留账户入口、Cloud-Vault 备份与 OsyC 设置入口。
- `AIAgentPane.svelte` / `AIAgentPaneView.ts`：顶部账户条由展示型元素改为按钮，直连账户弹窗。

## 验证证据

```text
npm run check                     # EXIT 0
  tsc-check                       0 errors
  tsc-check:apps                  0 errors
  lint                            0 errors, 9 existing warnings
  lint:community                  clean
  lint:community:tools            clean
  svelte-check                    0 errors, 0 warnings
  check:compatibility (iOS 15)    passed
vitest run src/osyc src/modules/features/SettingDialogue   38 files / 292 tests passed
```

## 发布状态（GitHub API 复核于 2026-09-16）

- 当前稳定版：`2.0.4`（2026-09-14 发布）。
- 前一稳定版：`2.0.3`。
- **`2.0.5` 只有 tag、没有 GitHub Release**，因此它不能作为 BRAT 可安装的回滚点；有效回滚目标是 `2.0.4`。
- `2.0.6` 无 tag、无 Release，源码停在 `af9bc5e`，本轮的设置页改动尚未提交。

## 待办

1. **真机验收**：iOS/Android 上确认四分组布局、折叠项展开、账户条点击路径。
2. **提交与推送**：把这批改动落到 `codex/2.0.6-stabilize` 并推送（`af9bc5e` 之后的工作区改动尚未提交）。
3. **重新生成五资产指纹**：`npm run check` 会重建 `main.js`，本轮又改了 `styles.css`，因此 `release-info.json` 里这两条已经过期，必须在**提交之后**再刷新（`sourceCommit` 也要改成新提交号），然后用 `node utils/verify-osyc-release.mjs` 复核。当前工作区实测值：

   | 资产 | `release-info.json` 记录 | 工作区实测 |
   | --- | --- | --- |
   | `main.js` | `03c4a7ac…dae2e3` | `4d1a7c1e…4ecc3df` |
   | `styles.css` | `a70070b9…95e4c54` | `a011369a…047969ba` |
   | `manifest.json` / `manifest-beta.json` / `versions.json` | — | 一致，无需改动 |

   注意：仓库内没有任何脚本会生成或校验 `release-info.json`；它靠人工维护，这也是它此前漂移的原因。
4. **`docs/releases/release-ledger.json` 本次已按 GitHub API 复核结果修正**（此前停留在 1.0.75 时代）；发布动作本身仍属 release-captain。
5. 后端 `stable206` 与 `/api/error-reports`、`/api/auth/email/*` 的门槛见 `docs/releases/osyc-2.0.6-launch-baseline.md`，本轮未触碰。

## 相关记录

- 变更记录：`docs/changes/codex-2026-09-16-osyc-native-settings-page.md`
- 计划：`docs/plans/osyc-settings-account-ui-2026-09-11.md`
- 声明式设置适配器设计：`docs/adr/2026_08_declarative_settings_adapter.md`
