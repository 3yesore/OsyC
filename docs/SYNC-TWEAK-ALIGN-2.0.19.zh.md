# OsyC 2.0.19：跨设备同步参数（tweak）差异对齐

> 本文只解释 2.0.19 的改动，不重复 `docs/DIAGNOSTICS-2.0.17.zh.md` 与
> `docs/SYNC-REPAIR-2.0.18.zh.md` 的内容。

## 1. 现场缺陷（为什么要改）

租户 `3YESORE-CENTCOLYS` 的真机现象：界面提示
「Some mismatches have been detected in the configuration between devices. Running a manual
replication will attempt to resolve this issue.」+「拉取失败：拉取未完成：远端连接失败或
同步已取消」，约 1 秒即失败。**这不是网络问题**，是复制根本没开始。

从 CouchDB 里程碑逐设备算出的差异：

| 设备 ID | 环境 | 插件 | 结论 | 唯一差异 |
|: --- |: --- |: --- |: --- |: --- |
| `dp8kfgfedn` | 服务端桥接 headless-vault | — | MATCH | 无 |
| `uijvlj47r8` | 老设备 | 2.0.12 | MATCH | 无 |
| `sw5pwoyc2f` | 老设备 | 2.0.12 | MATCH | 无 |
| `prhbe1lweg` | iOS / Learning-Vault | 2.0.18 | **MISMATCH** | `encrypt`: 本机 true / 云端 false |
| `m70kdx8mrh` | Windows / learning | 2.0.17 | **MISMATCH** | `customChunkSize`: 本机 60 / 云端 0 |

云端下发的 setup URI 解码后是 `encrypt: false` 且不含 passphrase；所以 iOS 上的
`encrypt: true` 是**设备本地状态**，不是配置下发的。

### 1.1 中止发生在哪里

`commonlib` 的 `pouchdb/LiveSyncDBFunctions.js` `ensureRemoteIsCompatible()` 会取远端里程碑
`_local/obsydian_livesync_milestone` 的 `tweak_values.PREFERRED`，与本机设置逐键比较；不一致就
返回 `[MISMATCHED, preferred]`。`replication/couchdb/LiveSyncReplicator.js` 收到后：

```
Logger(mismatchedTweakDetected);
this.tweakSettingsMismatched = true;
this.preferredTweakValue = preferred;
return false;   // 复制根本不会开始
```

### 1.2 2.0.18 为什么没修好

2.0.18 的「修复同步配置」只认两个缺陷签名：`customChunkSize === 60` 与 `remoteType` 规范化
（再加档案重建）。它**完全不看** `encrypt` 等 should-match 键，所以 iOS 用户点下去得到的是
「同步配置已是最新，无需修复」——复制其实被 `encrypt` 硬性阻断。用户被指向了一条不存在的
出路，这是本版要消除的产品缺陷。

### 1.3 需求变更：不允许让客户手动解决

第一版设计把 `encrypt` 差异交给用户确认。随后用户明确要求：**不要每次都让客户手动解决**。
因此 2.0.19 的最终行为是：

- **官方托管远端（`sacu3.cn` / `osyc_sync_*`）全自动对齐，包括 `encrypt`，不弹窗、不确认**；
- 自建 / 非托管远端才保留「只提示、用户确认后对齐」。

客户（官方托管租户）在这条链路上**不需要任何手动操作**。

## 2. 判定机制（必须与 commonlib 完全一致）

`ensureRemoteIsCompatible` 的真实判定是：

```
extractObject(TweakValuesShouldMatchedTemplate, { ...TweakValuesDefault, ...preferred_tweak })
extractObject(TweakValuesShouldMatchedTemplate, { ...TweakValuesDefault, ...current_tweak })
isObjectDifferent(上述两者, true)   // ignoreUndefined = true
```

> 注意 `ignoreUndefined = true` 的语义：**任一侧为 undefined 的键不参与判定**。
> 因此 `planTweakAlignment()` 逐键比较时也必须跳过「任一侧未设置」的键，否则会把
> LiveSync 根本不会判 mismatch 的键误报成差异，制造新的误诊。

远端 PREFERRED 的数据来源：`LiveSyncReplicator.getRemotePreferredTweakValues(setting)`
（`LiveSyncReplicator.js:1203`），返回 `{ status, values?, error?, reason? }`，状态有四种：

| status | 含义 | 本版处理 |
|: --- |: --- |: --- |
| `available` | 读到 PREFERRED | 逐键比较 |
| `not-configured` | 里程碑没有 PREFERRED | 本机值即基线，不会出现差异（与 LiveSync 兜底一致） |
| `unsupported` | 当前远端类型无 tweak 概念 | 无需比对 |
| `unavailable` | 读不到 | **不代表无差异**；界面对应的中文结论是「未能读取」，绝不是「已是最新」 |

## 3. 键表与分级

全部 18 个 must-match 键（顺序即 `TweakValuesShouldMatchedTemplate` 的键顺序，代码不手抄）：

| # | 键 | 中文 | 分级 | 处理 |
|: --- |: --- |: --- |: --- |: --- |
| 1 | `minimumChunkSize` | 最小分块大小 | incompatible | 官方自动 / 自建确认 |
| 2 | `longLineThreshold` | 长行阈值 | incompatible | 官方自动 / 自建确认 |
| 3 | `encrypt` | 端到端加密 | incompatible | 官方托管远端**自动**对齐；自建远端用户确认后对齐 |
| 4 | `usePathObfuscation` | 路径混淆 | incompatible | 官方自动 / 自建确认 |
| 5 | `enableCompression` | 启用压缩 | incompatible | 官方自动 / 自建确认 |
| 6 | `useEden` | 启用 Eden 增量同步 | incompatible | 官方自动 / 自建确认 |
| 7 | `customChunkSize` | 自定义分块大小 | compatible-lossy | 静默对齐 |
| 8 | `useDynamicIterationCount` | 动态迭代次数 | incompatible | 官方自动 / 自建确认 |
| 9 | `hashAlg` | 哈希算法 | compatible-lossy | 静默对齐 |
| 10 | `enableChunkSplitterV2` | 启用分块器 V2 | incompatible | 官方自动 / 自建确认 |
| 11 | `maxChunksInEden` | Eden 最大分块数 | incompatible | 官方自动 / 自建确认 |
| 12 | `maxTotalLengthInEden` | Eden 最大总长度 | incompatible | 官方自动 / 自建确认 |
| 13 | `maxAgeInEden` | Eden 最大保留时间 | incompatible | 官方自动 / 自建确认 |
| 14 | `usePluginSyncV2` | 插件同步 V2 | incompatible | 官方自动 / 自建确认 |
| 15 | `handleFilenameCaseSensitive` | 文件名大小写敏感 | incompatible | 官方自动 / 自建确认 |
| 16 | `useSegmenter` | 启用分词器 | incompatible | 官方自动 / 自建确认 |
| 17 | `E2EEAlgorithm` | 端到端加密算法 | incompatible | 官方自动 / 自建确认 |
| 18 | `chunkSplitterVersion` | 分块器版本 | compatible-lossy | 静默对齐 |

分级规则：

- `compatible-lossy` = commonlib 的 `CompatibleButLossyChanges`
  （`hashAlg` / `customChunkSize` / `chunkSplitterVersion`）；
- `incompatible` = **其余全部**，包含 commonlib `IncompatibleChanges` 的四个键
  （`encrypt` / `usePathObfuscation` / `useDynamicIterationCount` /
  `handleFilenameCaseSensitive`）以及未归类的 must-match 键。

「官方自动 / 自建确认」表示：在官方托管远端上由 `planTweakAlignment(..., tweakAlignmentOptionsForRemote(true))`
自动对齐；在自建 / 非托管远端上仍要求用户确认 —— 我们无权替用户决定关掉他自己的 E2EE。
未归类的键也归入需要确认的一侧，是因为静默改写它们同样可能丢数据，保守侧永远是安全侧。

## 4. 自愈规则：官方托管远端全自动，自建远端才要用户确认

### 4.1 官方托管远端（`sacu3.cn` / `osyc_sync_*`）= 零手动

判定用新导出的 `isOfficialManagedRemote()`：只看**硬证据** —— `couchDB_USER` 以
`osyc_sync_` 开头，或活动档案 / 顶层 `couchDB_URI` 指向 `sacu3.cn`。刻意**不认**
`isConfigured`（`isOsycProvisionedRemote` 的第一个分支）：那个弱信号会让「已完成配置但
远端换成自建 CouchDB」的设备也被自动关掉 E2EE。当
`getRemotePreferredTweakValues()` 返回 `available` 且 `values.encrypt === false` 时，
本机全部 should-match 键（**包括 `encrypt`**）自动对齐到远端 PREFERRED —— 不弹窗、不确认。
走的是 LiveSync 自己的「使用远端」分支
（`ModuleResolveMismatchedTweaks._askResolvingMismatchedTweaks` conf 分支的同一语义）：

1. `Object.assign(settings, extractObject(TweakValuesTemplate, preferred))`；
2. `core.services.setting.saveSettingData()`；
3. `core.services.control.applySettings()`；
4. `core.replicator.setPreferredRemoteTweakSettings(settings)`；
5. 差异含不兼容键 → `core.rebuilder.$fetchLocal()`；
6. 面板路径由 `reconcileSyncConfiguration()` 补一次拉取；pull 路径就是本次 pull 本身。

**为什么不许用户手动**：本机 `encrypt: true` 对着官方明文远端时，
`ensureRemoteIsCompatible` 永远返回 MISMATCHED，该设备**根本不可能同步成功**；对齐是唯一
出路，所以它必须自动化。用户原话：「不要每次都让客户手动解决」。

**为什么自动也安全**：E2EE 只加密**同步分块**，本地 `.md` 文件仍在磁盘上；
`$fetchLocal()` 重建的是同步库，不会删掉用户笔记。差异只是同步格式，不是用户数据。

**安全边界**：

- 只对官方托管远端自动改；自建 / 非托管远端返回 `handled: false`，仍然只提示；
- 只写 `TweakValuesTemplate` 里的 tweak 键，并再过一遍 `FORBIDDEN_KEYS`
  （`passphrase` / `encryptedPassphrase` / `encryptedCouchDBConnection` / 各类远端凭据）；
  凭据永远只能由激活流程写入。

### 4.2 四个执行时机

| 时机 | 入口 |
|: --- |: --- |
| 插件启动 | `void runReplicationRepair("startup")` |
| 激活成功之后 | `await runReplicationRepair("activation")` |
| 打开插件面板 / 账户弹窗同步面板 | `AIAgentPaneView.onPaneOpened` 与 `reconcileSyncConfiguration()` |
| **每次发起 pull 之前** | `runOneWayReplication("pullOnly")` 开头的 `autoAlignOfficialRemoteTweaks("before-pull")` |

「每次发起 pull 之前」是关键：设备一 online 就先自愈，用户根本看不到那句
「拉取失败：拉取未完成：远端连接失败或同步已取消」。

日志一条说清（`osycLogger` 会把 detail JSON 化）：

```
同步配置自愈 | {"aligned":["encrypt"],"remote_preferred":"available","rebuild":true}
```

### 4.3 自建 / 非托管远端：仍然只提示，不自动改

`runReplicationRepair()` 在这类远端上保持分级：

- 只含 `compatible-lossy`（`hashAlg` / `customChunkSize` / `chunkSplitterVersion`）：
  静默 `applyPartial(plan.silentPatch, true)` 并写日志（含「改了哪些键、本机值 → 云端值」）；
- 存在任何 `incompatible`：**不写任何设置、不拉取**，返回
  `{ requiresUserConfirmation: true, diffs, recommendedAction }`，由用户在差异列表上点
  唯一推荐动作 → `LiveSyncConfirmModal` 显式确认 → `control.alignTweaksToRemote()`；
- `unavailable`：不宣称无差异，结论是「未能读取云端同步参数」。

硬性约束：**只要存在差异，界面上就不会再出现「同步配置已是最新，无需修复」**。
（`src/osyc/features/AIAgent/tweakAlignment.unit.spec.ts` 用源码级断言锁死这句话不再出现。）

### 4.4 与 `checkAndAskResolvingMismatched` 的关系

本版**复用的就是 LiveSync 自己的实际执行路径**
（`extractObject(TweakValuesTemplate, preferred)` + `setPreferredRemoteTweakSettings` +
`$fetchLocal()`），没有自己发明对齐逻辑。

没有直接调 `_askResolvingMismatchedTweaks()` 的原因：它要求
`core.replicator.tweakSettingsMismatched` 已为真；而「修复同步配置」是在复制**已被中止之后**
主动发起的。也没有调 `checkAndAskResolvingMismatched()`：它给的是 LiveSync 原生 6 个混合
选项（采用云端/采用本机/带重建/不带重建/忽略），而官方托管远端的诉求是「零手动」，自建
远端的诉求是「一条中文警示 + 唯一推荐动作」。

## 5. UI

账户弹窗「同步」区的 LiveSync 面板（`AIAgentAccountModal.paintLiveSyncPanel`）：

1. 常显一行「远端同步参数：<状态中文>」；
2. 有差异时逐条列出「中文名（键名）：本机 X / 云端 Y」，并标注
   「（不可静默改写）」或「（可自动对齐）」；若复制器最近一次握手被判不一致，标题上会
   明确写出「这是复制被中止的直接原因」；
3. **官方托管远端**：差异会被自动对齐（通常在用户打开面板之前就已完成），面板上不再需要
   任何手动步骤；
4. **自建 / 非托管远端**：存在 `incompatible` 差异时出现**唯一推荐动作按钮**
   （`tweakAlignmentAction(view)`）：
   - 有 `encrypt`：按钮名「与云端对齐并关闭本机端到端加密」；
   - 否则：「与云端对齐同步参数」。
   点击后弹 `LiveSyncConfirmModal`（`risk = danger`）显式确认，文案：

   > 本地开启了端到端加密，云端是明文，复制会被中止；与云端对齐会关闭本地 E2EE 并重建
   > 本地同步库（本地未同步内容会被云端覆盖）。

   （无 `encrypt` 时用通用版文案。）取消则不改任何设置。

「修复同步配置」按钮同样接入这条链路：官方托管远端直接对齐并拉取；自建远端则在发现
`incompatible` 差异时弹确认，而不是假装修好了。

## 6. 诊断字段（必须能自证）

`livesync_summary` 新增三个字段：

| 字段 | 类型 | 来源 |
|: --- |: --- |: --- |
| `tweak_diff` | `{ [键]: { local, preferred } }` | `planTweakAlignment()`；空对象 = 逐键全等 |
| `remote_preferred_status` | `available` / `not-configured` / `unavailable` / `unsupported` / `null` | `getRemotePreferredTweakValues()` |
| `tweak_settings_mismatched` | boolean / null | `core.replicator.tweakSettingsMismatched` |

这三个字段全部是非敏感同步参数（布尔 / 数字 / 算法名），不含任何凭据；上传前仍会过一次
`sanitizeTweakDiff()`（字符串 bounded + redact，最多 18 个键）。

修复前的痛点：`livesync_summary.error` 是 `null`，用户上传的诊断看不出任何原因。现在一份
诊断就能直接回答「复制为什么没开始」：

```
"livesync_summary": {
  "tweak_diff": { "encrypt": { "local": true, "preferred": false } },
  "remote_preferred_status": "available",
  "tweak_settings_mismatched": true
}
```

## 7. 代码位置

| 文件 | 作用 |
|: --- |: --- |
| `src/osyc/features/AIAgent/tweakAlignment.ts`（新增） | 纯函数 `planTweakAlignment()`：18 键逐键比较 + 分级 |
| `src/osyc/features/AIAgent/livesyncSyncActions.ts` | 诊断字段 `tweak_diff` / `remote_preferred_status` / `tweak_settings_mismatched`、差异行、推荐动作 |
| `src/osyc/features/AIAgent/diagnosticsUpload.ts` | 上传前脱敏透传三个新字段 |
| `src/osyc/serviceFeatures/useAIAgentUI.ts` | 读远端 PREFERRED、官方托管远端全自动对齐（四个时机）、`alignTweaksToRemote()`、诊断采集 |
| `src/osyc/features/AIAgent/AIAgentPaneView.ts` | 面板打开时的自愈钩子 `onPaneOpened` |
| `src/osyc/features/AIAgent/livesyncPatch.ts` | 导出既有的 `FORBIDDEN_KEYS`，供自动对齐过滤凭据类键 |
| `src/osyc/features/AIAgent/AIAgentAccountModal.ts` | 差异列表 + 唯一推荐动作按钮（自建远端） |
| `src/osyc/features/AIAgent/LiveSyncConfirmModal.ts` | 确认弹窗放宽为只依赖 label / risk / confirmKeyword，供 tweak 动作复用 |
| `src/osyc/features/AIAgent/tweakAlignment.unit.spec.ts`（新增） | 阴阳对照、自动对齐对照与源码级契约 |

## 8. 验证

### 8.1 已在本仓库验证（`tweakAlignment.unit.spec.ts`，24 passed）

- 阴：`encrypt: true`（本机）vs `false`（云端）+ **非官方远端** → `requiresUserConfirmation=true`，
  `autoAlign === false`，`silentPatch` 为空（不自动关掉用户自己的 E2EE）；
- 阳：本机与云端逐键全等 → `noop === true`、`diffs === []`；
- **官方远端**：同样输入 → `requiresUserConfirmation === false`、`autoAlign === true`；
  应用 `alignedValues` 后 `planTweakAlignment()` 的 `diffs === []`（即真正的自动对齐）；
- 安全边界：`filterAlignmentPatch()` 丢掉 `passphrase` / `encryptedPassphrase` /
  `encryptedCouchDBConnection` / `couchDB_PASSWORD` / `couchDB_URI` / `secretKey`，只留 tweak 键；
- `customChunkSize 60 vs 0` → `compatible-lossy` + `silentPatch = { customChunkSize: 0 }`；
- 18 个键每个都能被判成差异；分级边界与 commonlib 常量一致；
- 读不到 PREFERRED 时 `available=false` 且 `noop=false`；
- 诊断载荷含 `tweak_diff` / `remote_preferred_status` / `tweak_settings_mismatched`；
- 源码级：四个自愈时机（startup / activation / panel / before-pull）、
  `isOfficialManagedRemote`、`extractObject(TweakValuesTemplate, preferred.values)`、
  `setPreferredRemoteTweakSettings`、`core.rebuilder.$fetchLocal()` 都在，
  且 `useAIAgentUI.ts` 不再出现「同步配置已是最新，无需修复」。

### 8.2 真机验证步骤（**需要在真实设备上执行，本仓库未跑**）

1. 复现面：在一台 iOS 设备的 LiveSync 原生设置里打开「端到端加密」（或从旧版本升级后保留该
   状态），确保云端 `PREFERRED.encrypt = false`，且该设备用的是官方托管远端；
2. 冷启动插件（或打开 OC 面板 / 账户弹窗）：**用户不做任何操作**，应在日志看到
   `同步配置自愈 | {"aligned":["encrypt"],"remote_preferred":"available","rebuild":true}`；
   设置里 `encrypt` 已被自动改为 `false`，`$fetchLocal()` 已触发；
3. 打开「我的账户」→ 同步区：应看到「远端同步参数：已读取」，且差异列表为空
   （自愈发生在面板读取之前）；**不应**出现任何确认按钮，也不应出现
   「同步配置已是最新，无需修复」；
4. 点「从远端拉取」或让 LiveSync 自己握手：复制应真正开始（服务端可见 `_changes` 请求），
   不再出现「拉取失败：拉取未完成：远端连接失败或同步已取消」；
5. 只读核对云端里程碑（不改服务端）：读 `_local/obsydian_livesync_milestone` 的
   `tweak_values.PREFERRED.encrypt` 是否为 `false`，以及本机节点条目是否已对齐。
6. 反例（自建远端）：把远端换成非 `sacu3.cn` 的自建 CouchDB，重复第 1 步 ——
   此时**不应**自动改设置，而应在同步区列出差异并给出唯一推荐动作按钮，由用户确认。

### 8.3 `customChunkSize 60` 真机面

Windows 设备（`m70kdx8mrh`）的 `customChunkSize: 60` 属 `compatible-lossy`：打开同步面板时
会被静默对齐到 `0`，界面上不出现确认按钮；差异列表在自愈前会短暂列出该键。

## 9. 明确不做的事

- 不修改 commonlib 的 `ensureRemoteIsCompatible` / 复制器，也不改远端任何数据；
- 不新增版本号、不改 `versions.json` / `package.json` / 台账 / release-info；
- 不触碰支付/充值相关文件；
- 不推送、不打 tag。
