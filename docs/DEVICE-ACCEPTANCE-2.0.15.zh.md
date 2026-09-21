# OsyC 2.0.15 真机验收清单（deviceAcceptance: pending-desktop）

> 适用版本：2.0.15 候选（基于 `origin/main` = 2.0.14 `da37be1` 的补门禁分支 `codex/gates-2.0.15`）。
> 台账状态：`docs/releases/release-ledger.json` 的 `currentStable.deviceAcceptance` 仍为
> `pending-desktop`。**本清单通过前，2.0.15 不得对外宣称完成设备验收。**
> 本文件只描述「在真机上看什么、期望看到什么、异常时要交回什么信息」，
> **不包含任何真实卡密、口令、setup URI 或邮箱地址**；现场参数请用本地临时文件流转。

---

## 0. 准备

- 一台 Android / iOS 手机 + 一台桌面（桌面用于对照 ④/⑤）。
- 安装待验收构建（BRAT / 侧载 2.0.15 候选），确认插件 ID 为 `osyc`、`manifest.json` 版本为 2.0.15。
- 打开开发者控制台：
  - 桌面：Obsidian「开发者工具 → Console」；
  - 手机：Obsidian 自带控制台（或 adb logcat 过滤 `OsyC`）。
- 记录日志的官方入口（命令面板）：**「打开日志」** 与 **「复制脱敏诊断报告」**（后者已做脱敏）。
- 关键本地文件：`.obsidian/plugins/osyc/data.json`（LiveSync 设置与自愈结果都落在这里）。
- 每步异常时，统一交回：**步骤号 + 手机型号/系统 + Obsidian 版本 + 截图 + 「复制脱敏诊断报告」全文 + data.json 中相关键（去掉凭据后再贴）**。

> 纪律：任何步骤都不要把卡密 / 口令 / setup URI 原文贴进 issue、聊天或仓库；需要时只给「库名 / 端点主机名 / 时间戳」。

---

## ① 首次启动：激活卡不被键盘遮挡（移动端）

- **位置**：手机 OC 面板首屏的「激活卡」（未激活时独占首屏，见 `src/osyc/features/AIAgent/AIAgentPane.svelte`）。
- **操作**：全新安装（或未激活状态）打开 OC 面板 → 点激活卡里的卡密输入框，弹出软键盘。
- **看点**：
  - 输入框与「激活」按钮是否仍在可视区内（可向上滚入），而不是被键盘顶到看不见；
  - 页面是否出现整页跳动的 `scrollIntoView` 式滚动（历史回归，应为「不整页滚」）；
  - 键盘弹出前后，时间线是否为键盘高度预留了滚动余量。
- **预期**：激活卡与输入框随宿主自然收缩保持在可视区，能直接输入并点击「激活」，无整页位移。
- **异常时交回**：机型 + 键盘应用 + 录屏（键盘弹出到输入完成）+ 控制台是否有错误。

---

## ② 卡密激活后立即同步到笔记（无档案时新建 legacy-couchdb）

- **位置**：首屏激活卡，或 账户弹窗 →「重新激活卡密」（`AIAgentAccountModal`）。
- **操作**：输入卡密激活；若提示 `provisioning_status=pending`（首次激活同步目标还没建好），按提示重试一次。
- **看点**：
  - 激活提示应为「…**同步已自动配置**」，**不得**出现「但同步配置失败，请手动设置」；
  - 打开 `.obsidian/plugins/osyc/data.json`：
    - `activeConfigurationId` 非空；
    - 若激活前**没有任何 couchdb 档案**，应新建并激活名为 `legacy-couchdb` 的档案；
    - 若已有 couchdb 档案，应改写该档案的 uri，而不是只改顶层字段；
    - `remoteConfigurations[activeConfigurationId].uri` 能解析为 couchdb 连接串，`couchDB_DBNAME` 非空。
  - 激活后**立即**应开始拉取/上传笔记（远端的 `obsydian_livesync_version` 之外开始出现真实文档）。
- **预期**：无档案的新 vault → `legacy-couchdb` 档案被创建并激活；旧档案设备 → 活动档案 uri 被改写到本次激活的端点；几十秒内笔记开始同步。
- **异常时交回**：激活提示原文 + data.json 的 `activeConfigurationId` / `remoteConfigurations` 键名（不贴 uri 原文）+ 「复制脱敏诊断报告」+ 远端库的 `doc_count`（由后台/运维侧查）。

---

## ③ 激活后回读自检失败时必须明确报错，而不是假装成功

- **位置**：激活链路 `applySetupUri` 的回读自检（`src/osyc/serviceFeatures/useAIAgentUI.ts`，
  判定函数 `verifyActivatedRemote` 在 `src/osyc/features/AIAgent/livesyncActivation.ts`）。
- **看点 / 判定**：
  - 自检通过才返回成功，提示「同步已自动配置」；
  - 自检失败时必须：控制台出现 `激活后未生成可用的同步档案：<原因>`，**并且** UI 提示含「同步配置失败，请手动设置」；
  - 绝不能出现「提示成功、但 data.json 里 `activeConfigurationId=""` 且 `remoteConfigurations={}`」的现场形态。
- **如何构造失败（任选，供验收用）**：让活动档案缺失或非 couchdb（例如手工把 `remoteConfigurations` 清空后重新激活），或用无法解析为连接串的坏 uri。
  - 注意：`verifyActivatedRemote` 只校验设置回读后的**可用档案形状**，不做网络连通性检查；「档案形状对但网络不通」属于 ④ 的诊断范围。
- **预期**：失败路径明确报错并返回 false（上层标记配置失败），绝不静默成功。
- **异常时交回**：控制台 warning 全文（含 `<原因>`）+ 当时的 UI 提示截图 + data.json 的 `activeConfigurationId` / `remoteConfigurations` 键名。

---

## ④ 账户弹窗同步区：看到诊断并可用按钮解决

- **位置**：账户弹窗「同步」区最下方的 **LiveSync 同步诊断**（`src/osyc/features/AIAgent/AIAgentAccountModal.ts`）。
- **看点（诊断栅格，逐行核对）**：

| 行 | 期望 |
| --- | --- |
| 活动档案 | 显示当前 `activeConfigurationId`（如 `legacy-couchdb` / `osyc`），不是空白 |
| 远端端点 | 本次激活的端点主机名（脱敏显示） |
| 远端类型 | `couchdb`（不应是 minio / p2p） |
| 协议版本 | 非空（能读到 `sync_parameters` 时） |
| 本机设备 | 本机 node id |
| 远端已接受 | **是/否**——「否」时顶部应出现红色告警 |
| accepted_nodes | 远端里程碑已接受的节点列表 |
| 最近拉取 / 最近推送 | 时间戳 |

- **看点（动作按钮）**：`接受远端里程碑 / 加入远端`、`从远端拉取`、`推送本机变更`、`重建本机（用远端覆盖本机）`；
  `覆盖远端（用本机覆盖远端）` 默认收在「最危险操作（用本机覆盖远端，默认收起）」折叠区内，且需二次确认。
- **操作**：当「远端已接受=否」时，点 `接受远端里程碑 / 加入远端`，回读后应变为「是」，并触发一次拉取。
- **预期**：诊断能一眼看出「卡在里程碑握手」还是「端点不通」；按钮能就地解决，用户不必去原生设置手点。
- **异常时交回**：诊断区截图 + 「复制脱敏诊断报告」+ 具体点了哪个按钮、按钮返回的 Notice 原文。

---

## ⑤ 工具中心-账户页两个新入口能打开且状态正确

- **位置**：OC 工具中心 →「账户」页（`src/osyc/features/AIAgent/AIAgentToolsModal.ts`）。
- **看点**：
  1. **邮箱账户** 行 +「打开」按钮；描述应为「未登录：用邮箱验证码登录，或绑定卡密」，或「已登录 <masked> · 已绑定 N 个卡密」；
  2. **独立同步空间（Pro）** 行 +「打开」按钮；未激活时描述为「激活账户后可查看 Pro 专属空间」；
     已激活时描述为「未开通 · 已用 X MB」/「已开通（就绪） · 已用 X MB」/「只读保留（Pro 已过期） · 已用 X MB」。
- **行为约束**：入口**只打开界面**——不自动发码、不自动登录、不自动开通/切换同步空间（显式动作口径）。
- **预期**：两个入口都能打开对应界面（邮箱区块 / Pro 区块），状态行与账户弹窗内同源一致。
- **异常时交回**：工具中心账户页截图 + 打开后的界面截图 + 控制台报错。

---

## ⑥ 独立同步空间「开通并切换到独立空间」落到 `t_pro` 库

- **位置**：账户弹窗「独立同步空间」区块的「当前空间」设置，按钮 **「开通并切换到独立空间」**。
- **前置**：Pro 档卡密、已激活、且空间未过期（过期是 200 + `status=expired`/`read_only=true`，按钮变「去续费」）。
- **操作**：点「开通并切换到独立空间」→ 按钮变「正在开通并切换…」。
- **看点**：
  - 完成后「空间状态」显示 **库名 `t_<uuid32>_pro` · 已开通 · 就绪 · 可读写**；
  - `data.json` 中活动档案 uri 解析出的 `couchDB_DBNAME` 以 `_pro` 结尾（即 `t_<uuid32>_pro`）；
  - 本 vault 开始向该独立库同步；原空间数据保留、可切回。
- **注意（旧明文卡密）**：为独立空间会生成**新的内容加密口令**，迁入等于「向新空间重新上传一次」，旧空间数据不删除。
- **预期**：显式点击后才切换；回读自检失败时会明确报「已开通独立空间，但本机同步档案回读自检失败…」，不静默成功。
- **异常时交回**：开通后的 Notice 原文 + 空间状态截图 + data.json 的活动档案库名（`t_..._pro`，可脱敏 uuid）。

---

## ⑦ 手机升级后启动自愈：旧 vault 是否开始下载（对照 `customChunkSize` 60 → 0）

- **位置**：启动自愈 `planProvisionedReplicationRepair`（`src/osyc/features/AIAgent/livesyncActivation.ts`），
  在插件加载时于 `src/osyc/serviceFeatures/useAIAgentUI.ts` 执行。
- **前置**：设备曾用 2.0.13（或带 `da64efe` 的构建）激活过，`data.json` 里 `customChunkSize` 被写成 **60**；
  同步账号 `couchDB_USER` 以 `osyc_sync_` 开头，且未切到别的远端。
- **操作**：升级到待验收构建 → 重启 Obsidian。
- **看点**：
  1. 升级**前**记录 `data.json` 的 `customChunkSize`（应为 60）；
  2. 升级后首次启动，日志出现 **`激活自愈：纠正 customChunkSize 为 0`**（若同时补了总开关，会拼成
     `激活自愈：补开 LiveSync 同步开关；纠正 customChunkSize 为 0`）；
  3. `data.json` 的 `customChunkSize` 变为 **0**，`liveSync` 为 true；
  4. 复制器不再 MISMATCHED，旧 vault 开始下载（文档数上升 / 笔记出现）。
- **预期**：无需用户重输卡密、无弹窗；旧 vault 自动开始下载。
- **已知边界**：若某租户远端里程碑的 `PREFERRED.customChunkSize` 已经是 60，本机改成 0 会反向制造一次
  mismatch；因属 `CompatibleButLossyChanges`，会由 `ModuleResolveMismatchedTweaks` 自动/交互对齐，本版接受这一次波动。
- **异常时交回**：升级前后 `customChunkSize` 值 + 启动日志（含自愈行）+ 远端里程碑 `PREFERRED`（运维侧查）+ 「复制脱敏诊断报告」。

---

## 附：判定为「通过」的最小证据集

1. ① 移动端激活卡键盘弹出录屏；
2. ② 激活成功提示 + `legacy-couchdb`（或既有档案改写）证据 + 笔记开始同步的证据；
3. ③ 失败路径日志与 UI 提示（可构造）；
4. ④ 同步诊断区截图（含「远端已接受」状态与动作按钮）；
5. ⑤ 工具中心两个入口截图与状态行；
6. ⑥ 开通后 `t_<uuid32>_pro` 库名与 data.json 证据；
7. ⑦ 升级前后 `customChunkSize` 对照 + 旧 vault 开始下载的证据。

全部通过后，才可把 `docs/releases/release-ledger.json` 的 `deviceAcceptance` 从 `pending-desktop` 改为已验收，并记录验收日期与机型。

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-21 | 初版：2.0.15 候选真机验收清单（7 步，deviceAcceptance 仍 pending-desktop） |
