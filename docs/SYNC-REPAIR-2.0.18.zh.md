# 同步配置自愈（2.0.18）

> 面向现场：**用户不需要点任何按钮，也不需要重新输入卡密**。2.0.17 上「拉取/推送
> 全部失败、无法完成首次同步、反复提示配置不匹配」的设备，升级到 2.0.18 后启动即自愈。

---

## 一、现象

用户（2.0.17 / iOS）反馈：

- 拉取、推送全部失败，首次同步永远完不成；
- 反复出现「配置不匹配」；
- 手机上**找不到「重新激活」按钮**，无法自救；
- 两台不同设备（`node m70kdx8m`、`node prhbe1lw`）现场一致。

上传的诊断里（脱敏后）：

```
settings_fingerprint = {
  customChunkSize: 60,
  hashAlg: xxhash64,
  chunkSplitterVersion: v3-rabin-karp,
  remoteType: null
}
milestone_accepted: true
configuration: CouchDB Remote
endpoint: sls+https://osyc3.sacu3.cn
protocol_version: 2
日志：OsyC LiveSync 同步失败 | mode=pullOnly,
      reason=拉取未完成：远端连接失败或同步已取消
```

服务器侧该租户库的 `_changes` 请求数 = **0**：复制器**从未启动**，所以不是网络问题，
而是本地配置让复制器在握手前就**静默中止**。

## 二、根因

两个缺陷叠在一起：

1. **`customChunkSize = 60`**。它属于 LiveSync 的 `TweakValuesShouldMatchedTemplate`
   （模板基线与 schema 默认值都是 `0`）。只要远端里程碑的 `PREFERRED.customChunkSize`
   还是 0，`ensureRemoteIsCompatible` 就返回 `["MISMATCHED", ...]`，复制器**直接中止** ——
   不是弹窗，而是静默永不同步。这个 60 是 2.0.13 的激活补丁写下的。
2. **`remoteType` 缺失 / 为 null**。LiveSync 里 CouchDB 的规范值是**空串**
   （`RemoteTypes.REMOTE_COUCHDB === ""`）。`ReplicatorService` 只有判定
   `remoteType === "" && couchDB_URI && couchDB_DBNAME` 才会初始化复制器；
   `undefined !== ""`，于是复制器同样不会启动。

两者任一都会让 `_changes` 恒为 0，表现成「拉取/推送全部失败」。

**为什么以前没修好**：2.0.17 的 `planProvisionedReplicationRepair` 守卫要求
「`isConfigured === true` **且** `couchDB_USER` 以 `osyc_sync_` 开头 **且** 当前没有
指向别的远端配置」三条**同时**成立。真实设备上 `activeConfigurationId` / 档案形态
一多，这条链就整体漏判 —— 于是修复函数在真机上**从未触发**，缺陷值一直留在设备上。

## 三、修法

### 3.1 守卫放宽（`src/osyc/features/AIAgent/livesyncActivation.ts`）

判断「是不是 OsyC 自己签发的远端」改为**三个来源任一成立**：

1. `isConfigured === true`；
2. `couchDB_USER` 是 provisioner 的 `osyc_sync_*` 账号；
3. 活动档案（或顶层 `couchDB_URI`）指向官方端点域 `*.sacu3.cn`。

判定成立后**无条件**按下述缺陷签名补齐（不再看 `activeConfigurationId`）：

| 缺陷 | 修补 |
| --- | --- |
| `liveSync !== true` | 补 `liveSync: true` |
| `customChunkSize === 60` | 改回 `0`（**精确匹配 60**，用户自配的其它值一律不动） |
| `remoteType` 缺失 / null / 空白，且活动档案可解析为 couchdb | 补上规范空串 `RemoteTypes.REMOTE_COUCHDB`（即 `""`） |

**关于 `remoteType === ""`**：LiveSync 用空串表示 CouchDB，**不能写字符串 `"couchdb"`** ——
它既不是合法 `RemoteType`，也会让 `isCouchDBConfigured` 恒为 false，复制器永不启动。
为了让诊断能直接证明修复生效，`buildSettingsFingerprint` 会把规范空串翻译成人类可读的
`couchdb` 再上报；键缺失 / null 仍上报 `null`（那才是真没配好）。

### 3.2 只下窄补丁、绝不整份替换

补丁只含 `liveSync / customChunkSize / remoteType` 三个键，只经
`core.services.setting.applyPartial(patch, true)` 浅合并，不碰
`remoteConfigurations`、不碰任何身份类字段（远端地址与凭据）。两条都不需要修时
`planProvisionedReplicationRepair` 返回 `null`，**零写入、零 `applySettings`**。

### 3.3 执行时机（全部自动，不依赖用户操作）

| 时机 | 落点 |
| --- | --- |
| 插件启动 | `useAIAgentUI` 加载时的 `runReplicationRepair("startup")` |
| 激活成功后 | `agent.applySetupUri` 回读自检通过后 `runReplicationRepair("activation")` |
| 每次打开账户弹窗 / 同步面板 | `AIAgentAccountModal.paintLiveSyncPanel` 先调 `control.reconcileSyncConfiguration()` |

三个时机共用同一个 `runReplicationRepair`：幂等、窄补丁、不需要修时零写入。

### 3.4 用户可见入口

2.0.17 的「重新激活卡密」藏在默认收起的 ``<details>`` 折叠区里，移动端用户点不出来 ——
这就是「找不到任何入口」的直接原因。2.0.18 把入口**上移到常显位置**：

- **「我的账户」弹窗**：同步状态区块内常显 ``修复同步配置`` 按钮；``重新激活卡密``
  从折叠区上移到同步区之后、折叠区之前；
- **工具中心 → 账户页**：同样常显 ``修复同步配置`` 与 ``重新激活卡密``。

「修复同步配置」一键：执行上面的自愈 → 完成后**立刻拉取一次** → 用 Notice
明确说明「改了什么 / 拉取是否成功」。修复失败会给出中文原因，绝不静默。

### 3.5 日志与诊断证据

自愈执行时写 `osycLogger`，含改了什么值：

```
同步配置自愈（startup） | {"changes":["纠正 customChunkSize 为 0","补上 remoteType 为 couchdb"], ...}
```

日志只含三个非敏感键，不含卡片 / token / 口令 / setup URI。用户下次上传诊断时，
`settings_fingerprint` 会直接显示：

```
customChunkSize: 0
remoteType: couchdb
```

## 四、用户无需任何手动操作

- 无需找「重新激活」按钮；
- 无需重新输入卡密；
- 无需进原生 LiveSync 设置改任何参数。

**升级到 2.0.18 后，插件启动即自愈，随后正常拉取。** 若仍失败，请上传诊断
（工具中心 → 调试 → 上传脱敏诊断），日志会带 `同步配置自愈（…）` 一行与
`settings_fingerprint`，可直接判断修复是否生效。

## 五、单测

`src/osyc/features/AIAgent/livesyncActivation.unit.spec.ts`

1. **守卫放宽**：仅 `isConfigured` 为真、或活动档案 uri 指向 `sacu3.cn`、
   或 `osyc_sync_` 前缀，三种来源各自都能触发纠正；
2. **60 → 0** 一条、**remoteType 补齐**一条；
3. **零写入**：`customChunkSize` 非 60、`remoteType` 已是规范值 / 其它合法类型时不产出补丁；
4. **幂等**：连跑两次只在第一次产出补丁（应用后第二次为 `null`）；
5. **新按钮**：账户弹窗与工具中心的测试断言 `修复同步配置` / `重新激活卡密`
   **不在默认收起的折叠区**内，且都调用同一个 `repairSyncConfiguration()`。

`src/osyc/features/AIAgent/livesyncSyncActions.unit.spec.ts` 另断言指纹把空串
翻译为 `couchdb`、键缺失仍为 `null`。

## 六、门禁

```
npx tsc --noEmit --skipLibCheck
npm run lint
npm run svelte-check
npm run test:unit -- --pool=threads
```

均为 0 error / 全绿（**不执行 `npm run build`**）。
