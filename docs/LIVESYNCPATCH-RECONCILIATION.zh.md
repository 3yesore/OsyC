# livesyncPatch setup-URI 解码逻辑归一决策（2.0.14）

状态：已定稿（评审先行，先出结论再改代码）；并解释 2026-09 手机故障的因果链（见 3.1 节）
范围：`src/osyc/features/AIAgent/livesyncPatch.ts` 及其单测
涉及提交：

| 代号 | 提交 | 分支 | 内容 |
| --- | --- | --- | --- |
| **R** | `da64efe` | `release/2.0.13` → `release/2.0.14` | 激活时若无 couchdb 档案，当场新建 `legacy-couchdb` 并激活；并写入 `customChunkSize=60` |
| **W** | `88fe5e9` | `codex-livesyncpatch-wip-20260919` | setup-URI 解码层重构 WIP：`liveSync`、`doctorProcessedVersion`、`keepReplicationActiveInBackground` |
| 基线 | `2a1a188` / `3f2f6ad` / `0fc8f66` / `7b01b28` | `release/2.0.14` | `liveSync`、档案改写、`remoteType` 钉死、回读自检 `verifyActivatedRemote` |

## 1. 两条线各自解决什么问题

**R（2.0.13 现场修复）**

- 现场事故：新 vault / 新设备激活后 `data.json` 里 `couchDB_*` 全空、`remoteConfigurations={}`、`activeConfigurationId=""`，客户端没有任何远端，一条笔记都读不到。
- 根因：`planCouchDbRemoteConfigurationReroute` 在「没有 couchdb 档案」时只把 `activeConfigurationId` 置空，指望下次启动的 `migrateLegacyRemoteConfigurationsInPlace` 从顶层字段重建；但 `SettingService` 保存时会把明文凭据加密进 `encryptedCouchDBConnection` 并清空顶层 `couchDB_URI`，而该迁移的前提是**明文** `couchDB_URI`（`hasText(settings.couchDB_URI)`）。于是 `hasCouchDB=false`，档案永远建不出来。
- 做法：当场用本次解码结果 `ConnectionStringParser.serialize` 出 uri，新建 `legacy-couchdb` 档案并激活，不再依赖 migration。
- 同一次提交还加了 `customChunkSize: DoctorRegulation.rules.customChunkSize?.value ?? 60`：让设备不再落在 Doctor 的 `customChunkSize` 违规上，避免冷启动时的「配置诊断」模态弹窗卡住启动链。

**W（setup-URI 解码重构 WIP，提交说明自述「只保留唯一未合并的工作」）**

- 同样看到了 Doctor 弹窗卡死启动链的问题（`ModuleLiveSyncMain → onFirstInitialise → runDoctor → performDoctorConsultation` 是 `await` 的，且排在 `control.applySettings()` 之前），但给出了**相反**的修法：写 `doctorProcessedVersion = DoctorRegulation.version`，等价于用户点了问诊对话框的「Dismiss this version」，让问诊走静默早退分支。
- 额外补齐：`liveSync: true`（复制器总开关，载荷不含）、`keepReplicationActiveInBackground: true`（窗口隐藏时不断开复制）。
- 明确主张「不得擅自引入 must-match 参数」，其单测断言 `"customChunkSize" in patch === false`——与 R 直接冲突。

## 2. 重叠与冲突

| 项 | R | W | 结论 |
| --- | --- | --- | --- |
| `liveSync: true` | 已有（`2a1a188`） | 重复添加 | **相同**，保留一处（R 侧已存在，W 的是冗余） |
| `remoteType: ""` | 已有（`0fc8f66`） | 未涉及 | 保留 R 侧（W 未触碰，无冲突） |
| legacy-couchdb 档案创建 | `da64efe` | 不涉及（W 早于该提交） | 保留 R 侧，正交、必须成立 |
| Doctor 启动闸门 | `customChunkSize=60` | `doctorProcessedVersion=version` | **互斥，必须二选一** |
| 后台复制 | 无 | `keepReplicationActiveInBackground: true` | 采纳 W（纯增量） |
| sanitize 白名单 | 未变 | 未变 | 一致 |
| 单测 | `livesyncPatch.unit.spec.ts` 锁 `customChunkSize` | 重写该文件、断言禁止 `customChunkSize` | 归一到新断言集 |

冲突的只有一处，但它是**同一行代码的两种反向实现**，盲合并（cherry-pick W 到 R）必然让其中一个断言失败，并可能同时留下两份互相覆盖的处理。

## 3. 决策：采纳 W 的 `doctorProcessedVersion`，弃用 R 的 `customChunkSize=60`

理由（全部可回溯到 commonlib 源码与本仓库测试）：

1. **`customChunkSize` 是 must-match 参数，写 60 会制造跨设备分歧。**
   `TweakValuesShouldMatchedTemplate.customChunkSize = 0`（`dist/common/models/tweak.definition.js:10`）。
   `ensureRemoteIsCompatible`（`dist/pouchdb/LiveSyncDBFunctions.js:83-96`）在 `disableCheckingConfigMismatch` 为 false 时，把远端里程碑的 `PREFERRED` 与当前值各取一次该模板子集比较，不同即返回 `["MISMATCHED", ...]`。
   只要远端里程碑的 `PREFERRED.customChunkSize` 还是 0（旧版本 OsyC 设备、或任何先写入里程碑的设备都会留下 0），本地 60 就会命中 MISMATCHED，复制器直接中止。
   这不是「弹个提示」，而是**静默永不同步**——比它要修的问题更严重。
2. **`doctorProcessedVersion` 不改任何设置值，因此不制造 must-match 分歧。** 它是上游自己的「Dismiss this version」语义（`configForDoc.js:186-191`），规章版本升级后咨询会重新出现。
3. **R 想避免的后果（启动被问诊阻塞）由 W 的机制同样覆盖，且覆盖得更彻底**：早退发生在规则评估之后、任何交互之前。
4. 已验证 R 的主张不成立：W 在提交注释中断言 customChunkSize=60 会触发 MISMATCHED，本仓库新增测试用**真实的** `TweakValuesShouldMatchedTemplate` / `TweakValuesDefault` / `extractObject` / `isObjectDifferent` 复刻了 `ensureRemoteIsCompatible` 的判定并锁定该冲突。

**被弃用那套（R 的 customChunkSize）的行为如何被保留：**

- R 真正要达成的行为是「冷启动不被 Doctor 问诊弹窗拦住，复制器能走到 `applySettings`」。该行为**没有丢**，改由 `doctorProcessedVersion` 实现，并且新增了「即使仍有违规也不弹窗」的集成测试与「去掉这一行就会弹窗」的对照组测试，保证该行为被不可静默删除地锁住。
- 归一后 `buildSetupPatch` **不制造任何 must-match 偏差**；新增不变量测试：补丁里除载荷键外，只能出现登记过的开关（`isConfigured` / `liveSync` / `remoteType` / `doctorProcessedVersion` / `keepReplicationActiveInBackground`），且不得新增 `TweakValuesShouldMatchedTemplate` 中的键。

**已知代价（明确接受）：**

- 静音是**整版、不分等级**的，会一并静音 Necessary 级建议（如 `hashAlg`），以及 Must 级规则的提示。代价是「用户可能得不到某些升级建议」；收益是「不会再因弹窗永久停摆，也不会因迎合推荐值而 MISMATCHED」。
- 对全新安装/新设备无风险：默认值 `hashAlg=xxhash64`、`chunkSplitterVersion=v3-rabin-karp` 本已合规，违规主要只来自 `customChunkSize`。

**被否决的其它方案：**

- 同时写 `customChunkSize=60` 和 `doctorProcessedVersion`：冗余且仍然引入 must-match 偏差，等于把 R 的坑原样带回。
- 写 `customChunkSize=60` + `disableCheckingConfigMismatch=true`：绕过 MISMATCHED 检查，直接削弱跨设备一致性保护，不可接受。
- 写 `customChunkSize=0`（等于不写）但不静音：问诊弹窗会阻塞启动，即 R 修复前的现场。

### 3.1 线上事故因果链与现场对照（2026-09 手机故障）

这一节把上面的机制判定落到一次真实线上事故上。手机故障的现场症状是「激活成功、配置也在，但一个文件都读不到」；两条独立路径的对照把根因指向 `customChunkSize`。

因果链：

1. 手机走激活路径：`applySetupUri` → `buildSetupPatch(decoded)`，2.0.13 在这里额外写下 `customChunkSize: 60`。
2. 云端租户里程碑的 `PREFERRED` 由更早的设备写入；那些设备（以及手工修复的写入）以 `DEFAULT_SETTINGS` 为基线，`customChunkSize = 0`。
3. 手机下一次复制握手，`ensureRemoteIsCompatible` 比较 `PREFERRED.customChunkSize(0)` 与当前 `60`（两者都在 `TweakValuesShouldMatchedTemplate` 中，模板基线 0），`isObjectDifferent(..., true)` 为真，返回 `["MISMATCHED", preferred_tweak]`。
4. 复制器在 `LiveSyncReplicator.js:774-778` 的 `MISMATCHED` 分支把 `tweakSettingsMismatched` 置位并 `return false`：**连接根本不会打开**，既不上传也不下载。
5. 观感就是「激活 HTTP 成功、设置也写进去了，但笔记一篇都不出现」。

现场对照（决定性证据）：

| 路径 | 写入的 `customChunkSize` | 与远端 `PREFERRED=0` | 结果 |
| --- | --- | --- | --- |
| 手机：2.0.13 激活路径（`buildSetupPatch`） | 60 | 不一致 | MISMATCHED，静默不拉 |
| Sacu vault：2.0.13 上手工修复（以 `DEFAULT_SETTINGS` 为基线） | 0 | 一致 | 握手 OK，133 篇全部拉到 |

两条路径唯一的差异就是 `customChunkSize` 的取值，一个中止、一个正常——这不是「看起来对」，而是同一判定机制下的对照实验。结合 `TweakValuesShouldMatchedTemplate.customChunkSize = 0` 与本仓库新增的单测，可以确认：2.0.13 的激活补丁**自己制造了**用户手机故障。

恢复路径为什么时灵时不灵：commonlib 在 MISMATCHED 之后并非完全没有出路——插件层的 `ModuleResolveMismatchedTweaks` 在 mismatch 只由 `CompatibleButLossyChanges`（含 `customChunkSize`）构成、且 `autoAcceptCompatibleTweak !== false` 时，会按 `tweakModified` 时间戳自动选择一侧对齐；否则弹出一个默认动作为 `Dismiss` 的对话框（`src/modules/coreFeatures/ModuleResolveMismatchedTweaks.ts:67-90, 195-230`）。因此最终能否自愈取决于该设备的 `tweakModified` 新旧、以及是否混入了非 lossy 的 mismatch——这解释了现场「有的手机一直不拉、有的设备偶发恢复」。

> 步骤 3-4 的机制已由 commonlib 源码与本仓库单测确认；「手机当时确实落在这一步」由上面的现场对照支持，属于高置信度推断，未对手机现场日志逐条插桩（见第 7 节）。

## 4. da64efe 行为的保留（与本决策正交）

`planCouchDbRemoteConfigurationReroute` 的「无档案 → 当场新建 `legacy-couchdb` 并激活」完整保留，`customChunkSize` 的取舍不影响它。

测试证据（`src/osyc/features/AIAgent/livesyncPatch.remoteConfig.unit.spec.ts`）：

- 用例「无档案 + 完整解码：当场新建 legacy-couchdb 并激活，且不依赖 migration」：
  - 输入复刻事故现场 `{ remoteConfigurations: {}, activeConfigurationId: "" }`；
  - 断言 `changed === true`、`activeConfigurationId === "legacy-couchdb"`；
  - 用**真实** `ConnectionStringParser.parse` 解回新建档案，断言 `type === "couchdb"`、uri/dbname/user/password 指向本次解码结果；
  - 再用 7b01b28 的 `verifyActivatedRemote` 回读同一份 plan，断言 `{ ok: true }`——直接证明「仅凭本次激活写下的档案就可用，不需要等下一次启动的 migration」。
- 既有用例继续覆盖：改写已有 couchdb 档案、S3/P2P 原样保留、坏 uri 不炸、幂等、载荷不完整不动档案。

## 5. 安全红线（归一不得削弱）

1. **身份类键只能由激活流程写入**：`FORBIDDEN_KEYS` 原样保留；`sanitizeLivesyncPatch` 依旧拒绝 `couchDB_*` / `bucket` / `accessKey` 等，并新增断言拒绝 `doctorProcessedVersion` / `keepReplicationActiveInBackground`（不在白名单）。
2. **不整份替换用户设置**：`buildSetupPatch` 只合并载荷键 + 显式开关，不以 `DEFAULT_SETTINGS` 打底整体覆盖；`applySetupUri` 走 `applyPartial`。
3. **回读自检保留**：`verifyActivatedRemote` 未改动，且被归一后的档案创建用例直接调用。

## 6. 归一后的最终形态

- `livesyncPatch.ts`：删除 `customChunkSize` 写入；新增 `doctorProcessedVersion: DoctorRegulation.version` 与 `keepReplicationActiveInBackground: true`；`liveSync: true`、`remoteType: ""`、档案 reroute 全部保留。
- `livesyncPatch.unit.spec.ts`：19 个用例，锁总开关、remoteType、Doctor 静默、后台复制、must-match 不变量、sanitize 边界。
- `livesyncPatch.remoteConfig.unit.spec.ts`：9 个用例，锁 da64efe 的档案创建与回读自检。

## 7. 未验证 / 待确认

- 未在真机重启后验证 `doctorProcessedVersion` 对「冷启动不弹窗」的端到端效果（只有单元级 `performDoctorConsultation` 集成测试）。
- 未验证同时存在旧版 OsyC 设备（`customChunkSize=0`，由 R 写坏为 60 的历史设备）时的互操作；归一只能防止**新的**激活再制造该偏差，不能自动修复已经写成 60 的设备。此类设备的纠正方案见第 8 节（提案，未实现）。
- 手机故障的现场日志未逐条插桩，因果链属高置信度推断（见 3.1 节）。
- `keepReplicationActiveInBackground` 的耗电/流量影响未量化（上游描述为 desktop only、更耗电）。

## 8. 对已用 2.0.13 激活过的设备的修复方案（提案，未实现）

问题：归一只能保证**将来**的激活不再写 60；`applyPartial` 不会主动清掉设备上已经存在的 60，所以历史设备不会被 2.0.14 自动纠正。

**结论：建议做一次最小的一次性纠正性写入，但不擅自实现。**

推荐做法（最小、可单测）：扩展已有的启动自愈入口 `planProvisionedReplicationRepair`（`src/osyc/features/AIAgent/livesyncActivation.ts`，插件加载时运行、已有单测），在它已经检查的「OsyC provisioner 租户账号（`couchDB_USER` 以 `osyc_sync_` 开头）+ `isConfigured`」基础上增加一条精确的缺陷签名：

- 条件：`customChunkSize === 60`（激活补丁写下的确切缺陷值，不是「任意非 0」）。
- 动作：补丁额外返回 `customChunkSize: 0`（`liveSync: true` 保留）。
- 安全性：只命中由 OsyC 激活路径写坏的设备；用户自配的 CouchDB / S3 / P2P（无 `osyc_sync_` 前缀）不受影响；0 是 schema 默认值与 must-match 模板基线，是「正确」值。
- 风险/边界：若某租户的 `PREFERRED` 真的已经是 60（一台故障设备最先写入里程碑，`ensureRemoteIsCompatible` 只写一次 `PREFERRED`），把本机改成 0 会反向制造一次 mismatch。由于 `customChunkSize` 属于 `CompatibleButLossyChanges`，插件层的 `ModuleResolveMismatchedTweaks` 会自动/交互地对齐，但仍有一次波动。若要完全避免，可把动作升级为「读取远端里程碑的 `PREFERRED.customChunkSize` 并对齐到它」——那需要一次远端读，比最小方案重。

次选（不改设置值，走既有恢复器）：把 `autoAcceptCompatibleTweak` 显式钉为 `true`，并确保激活不因写 `usePluginSyncV2` 等 tweak 键而把 `tweakModified` 顶到最新（否则自动对齐会按「本地更新」选择保留 60）。该路径依赖插件层启发式，确定性不如上面的精确写入。

不推荐：写 `disableCheckingConfigMismatch = true` 绕过检查（削弱跨设备保护）；或在 `buildSetupPatch` 里无条件把 `customChunkSize` 归零（会覆盖用户的显式选择，且仍可能对抗 `PREFERRED=60`）。

这一步需要改 `livesyncActivation.ts`（不在本次归一改动范围内），且直接作用于线上设备，故**只给方案、不实现**，等确认后再单独提交。
