import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";

/**
 * 激活自愈：保证「输入卡密后 vault 真的能上云」。
 *
 * ## 背景（2026-09-18 生产实测）
 *
 * 激活流程把后端下发的 setup URI 合并进 LiveSync 设置，但那段载荷**不含
 * `liveSync`**，而 LiveSync 的默认值是 `false`。复制器的启动条件是
 * `liveSync || syncOnStart`（`ModuleReplicatorCouchDB._everyAfterResumeProcess`），
 * 两个都为 false 时它根本不会打开。
 *
 * 结果：激活 HTTP 200、设置也写进去了，**但一条笔记都不会上传** ——
 * 远端库只有 `obsydian_livesync_version`，服务端 vault 恒为空，AI 只能回答
 * 「没有找到任何笔记」。生产上 `3YESORE-CENTCOLYS` 的租户
 * `t_37e5e9d0…` 就是这个状态（doc_count = 1）。
 *
 * ## 为什么用「用户名前缀」判断是不是我们配置的
 *
 * setup URI 的载荷契约（commonlib 0.1.23 实测，见 `tools/verify_setup_uri.mjs`）
 * 只有 9 个键：`couchDB_URI` / `couchDB_USER` / `couchDB_PASSWORD` /
 * `couchDB_DBNAME` / `isConfigured` / `usePluginSyncV2` /
 * `configPassphraseStore` / `encryptedCouchDBConnection` / `encryptedPassphrase`。
 *
 * 也就是说客户端侧**拿不到** `remoteConfigurations` / `activeConfigurationId`
 * 之类的来源标记（那些是 CLI 自己生成的）。而 provisioner 给每个租户建的
 * CouchDB 账号固定叫 `osyc_sync_<32hex>` —— 这个前缀随载荷一起下发，
 * 是唯一可靠、且在客户端可直接读到的「这是 OsyC 配置的同步」凭据。
 *
 * ## 为什么只在启动时补
 *
 * 激活时补（`buildSetupPatch`）只救**之后**的激活；已经被写坏的设备不会因为
 * 版本升级自己好起来 —— 除非用户重输卡密。这里在插件加载时补一次，
 * 让已经激活过的设备下次启动就开始上传。
 */

/** provisioner 为每个租户创建的 CouchDB 同步账号前缀。 */
export const OSYC_SYNC_USER_PREFIX = "osyc_sync_";

/** 激活流程可能写入的远端配置 id（CLI 侧使用；插件侧载荷里没有）。 */
export const OSYC_REMOTE_CONFIG_ID = "osyc";

/**
 * 2.0.13 激活补丁写下的缺陷值：`buildSetupPatch` 无条件写 `customChunkSize: 60`。
 * 该键属于 `TweakValuesShouldMatchedTemplate`（模板基线 0），写成 60 后只要远端里程碑
 * 的 `PREFERRED.customChunkSize` 还是 0，`ensureRemoteIsCompatible` 就返回
 * `["MISMATCHED", ...]`，复制器静默中止。因果链见
 * docs/LIVESYNCPATCH-RECONCILIATION.zh.md。
 */
export const BUGGY_ACTIVATION_CHUNK_SIZE = 60;

/** customChunkSize 的正确基线：schema 默认值，也是 must-match 模板值。 */
export const COMPATIBLE_CHUNK_SIZE_BASELINE = 0;

/**
 * 自愈补丁：补开总开关 + 纠正 2.0.13 写坏的分块参数，不碰任何身份类字段。
 *
 * 字段都是可选的：不同历史设备的缺陷形态不同（有的只差 `liveSync`，有的只差
 * `customChunkSize`，有的两者都差），都不需要修时返回 null。
 */
export interface ReplicationRepair {
    liveSync?: true;
    customChunkSize?: number;
}

type SettingsShape = {
    isConfigured?: unknown;
    liveSync?: unknown;
    activeConfigurationId?: unknown;
    couchDB_USER?: unknown;
    customChunkSize?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判断启动自愈需要写下什么补丁。纯函数，方便单测。
 *
 * 先过安全阀（全部满足才考虑修）：
 * 1. 这份配置已经完成过配置（`isConfigured === true`）—— 没配过的安装不动；
 * 2. `couchDB_USER` 是 OsyC provisioner 创建的 `osyc_sync_*` 账号
 *    —— 用户自己配的 CouchDB / 对象存储 / P2P 不会命中；
 * 3. 当前激活的不是别的远端配置。
 *
 * 第 2、3 条是安全阀：只修「由激活流程配置、且用户没有切到别的远端」的安装，
 * 不会覆盖用户自己的同步选择。
 *
 * 再按缺陷签名补齐：
 * - `liveSync !== true` → 补 `liveSync: true`（2.0.11 前的载荷不含该键）；
 * - `customChunkSize === 60` → 改回 `0`。**精确匹配 60**，不是「任意非 0」：
 *   0 是正常基线，用户自配的其它值是用户选择，都不动。
 *
 * 都不需要修时返回 null（避免无谓写盘）。
 */
export function planProvisionedReplicationRepair(settings: SettingsShape | null | undefined): ReplicationRepair | null {
    if (!isRecord(settings)) return null;
    if (settings.isConfigured !== true) return null;

    const user = settings.couchDB_USER;
    if (typeof user !== "string") return null;
    if (!user.trim().toLowerCase().startsWith(OSYC_SYNC_USER_PREFIX)) return null;

    const active = typeof settings.activeConfigurationId === "string" ? settings.activeConfigurationId : "";
    if (active && active !== OSYC_REMOTE_CONFIG_ID) return null;

    const repair: ReplicationRepair = {};
    if (settings.liveSync !== true) {
        repair.liveSync = true;
    }
    if (settings.customChunkSize === BUGGY_ACTIVATION_CHUNK_SIZE) {
        // 2.0.13 的激活补丁写下的缺陷值：改回 must-match 基线，让复制器不再 MISMATCHED。
        repair.customChunkSize = COMPATIBLE_CHUNK_SIZE_BASELINE;
    }
    if (repair.liveSync === undefined && repair.customChunkSize === undefined) return null;
    return repair;
}


/** 激活回读自检的结果。`reason` 为可直接拼进日志的中文原因。 */
export interface ActivatedRemoteVerification {
    ok: boolean;
    reason?: string;
}

/**
 * 激活回读自检：确认刚写进去的设置在**读回来之后**仍然指向一个可用的 couchdb 远端。
 *
 * ## 为什么需要这个自检（2026-09-20 现场元问题）
 *
 * 激活流程此前只保证「applyPartial 没抛异常」，从不回读验证结果。现场：
 * 插件报告激活成功，但客户端 LiveSync 的 data.json 里
 * `couchDB_URI/USER/PASSWORD/DBNAME` 全空、`remoteConfigurations={}`、
 * `activeConfigurationId=""`，客户端没有任何可用远端，一条笔记都读不到
 * （服务端库里其实有 2954 个 doc）。
 *
 * ## 为什么判定必须看档案 uri，而不是顶层 couchDB_*
 *
 * `SettingService` 保存时会把明文凭据加密进 `encryptedCouchDBConnection`
 * 并**清空**顶层 `couchDB_URI/USER/PASSWORD/DBNAME`，所以顶层字段为空
 * 完全可能是正常状态，不能作为失败判据。真正决定下次启动能否连上的，是
 * `activeConfigurationId` 指向的 `remoteConfigurations[id].uri` ——
 * `loadSettings()` 存在该档案时会用它的 uri 覆盖顶层字段。
 * 反过来，顶层字段即使还有残留值，只要活动档案缺失 / 不是 couchdb，
 * 下次启动就会被覆盖回空或旧端点。
 *
 * ## 行为
 *
 * 纯函数，**不抛异常**：任何缺失、类型不对、解析失败都折叠成
 * `{ ok: false, reason }`，由调用方决定 console.warn 与返回值。
 */
export function verifyActivatedRemote(settings: unknown): ActivatedRemoteVerification {
    if (!isRecord(settings)) {
        return { ok: false, reason: "读回的设置为空或不是对象" };
    }
    const activeConfigurationId =
        typeof settings.activeConfigurationId === "string" ? settings.activeConfigurationId.trim() : "";
    if (!activeConfigurationId) {
        return { ok: false, reason: "activeConfigurationId 为空" };
    }
    const remoteConfigurations = settings.remoteConfigurations;
    if (!isRecord(remoteConfigurations)) {
        return { ok: false, reason: "remoteConfigurations 为空或不是对象" };
    }
    const configuration = remoteConfigurations[activeConfigurationId];
    if (!isRecord(configuration)) {
        return {
            ok: false,
            reason: `activeConfigurationId「${activeConfigurationId}」在 remoteConfigurations 里不存在`,
        };
    }
    const uri = typeof configuration.uri === "string" ? configuration.uri.trim() : "";
    if (!uri) {
        return { ok: false, reason: `活动档案「${activeConfigurationId}」的 uri 为空` };
    }
    let parsed: ReturnType<typeof ConnectionStringParser.parse>;
    try {
        parsed = ConnectionStringParser.parse(uri);
    } catch {
        return { ok: false, reason: `活动档案「${activeConfigurationId}」的 uri 无法解析为连接串` };
    }
    if (parsed.type !== "couchdb") {
        return {
            ok: false,
            reason: `活动档案「${activeConfigurationId}」不是 couchdb 远端（实际为 ${String(parsed.type)}）`,
        };
    }
    // 只用档案 uri 解析出的值：顶层明文 couchDB_* 会被保存时清空。
    const couchDB_URI = typeof parsed.settings.couchDB_URI === "string" ? parsed.settings.couchDB_URI.trim() : "";
    const couchDB_DBNAME =
        typeof parsed.settings.couchDB_DBNAME === "string" ? parsed.settings.couchDB_DBNAME.trim() : "";
    if (!couchDB_URI) {
        return { ok: false, reason: `活动档案「${activeConfigurationId}」解析出的 couchDB_URI 为空` };
    }
    if (!couchDB_DBNAME) {
        return { ok: false, reason: `活动档案「${activeConfigurationId}」解析出的 couchDB_DBNAME 为空` };
    }
    return { ok: true };
}
