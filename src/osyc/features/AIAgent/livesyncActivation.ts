import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import { RemoteTypes, type RemoteType } from "@vrtmrz/livesync-commonlib/compat/common/types";

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

/**
 * LiveSync 用**空串**表示 CouchDB 远端（commonlib 0.1.19 实测
 * `RemoteTypes.REMOTE_COUCHDB === ""`）。`ReplicatorService` 只有判定
 * `remoteType === REMOTE_COUCHDB` 才会初始化复制器 —— 所以这里绝不能写字符串
 * `"couchdb"`：它既不是合法 RemoteType，也会让 `isCouchDBConfigured` 恒为 false，
 * 复制器永远不启动（比要修的问题更糟）。
 *
 * 设备上真正会坏的是「该键缺失 / 为 null」：`undefined !== ""`，同样恒 false，
 * 表现为复制器从未启动、服务端 `_changes` 请求数恒为 0。自愈把这种情况补成
 * 规范空串；已经是规范空串时不写盘（幂等、零写入）。
 */
export const OSYC_COUCHDB_REMOTE_TYPE: RemoteType = RemoteTypes.REMOTE_COUCHDB;

/**
 * 官方 LiveSync 端点域名后缀。活动档案 uri 落在这些域名下，即可认定是
 * OsyC 自己签发的远端（见 {@link isOsycProvisionedRemote}）。
 */
export const OSYC_OFFICIAL_ENDPOINT_SUFFIXES: readonly string[] = ["sacu3.cn"];

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
    /** 修正后的远端类型；LiveSync 的 CouchDB 规范值是空串（见 {@link OSYC_COUCHDB_REMOTE_TYPE}）。 */
    remoteType?: RemoteType;
}

type SettingsShape = {
    isConfigured?: unknown;
    liveSync?: unknown;
    activeConfigurationId?: unknown;
    couchDB_USER?: unknown;
    customChunkSize?: unknown;
    remoteType?: unknown;
    couchDB_URI?: unknown;
    remoteConfigurations?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 活动档案的 uri（`remoteConfigurations[activeConfigurationId].uri`）。
 * 缺失、类型不对或 activeConfigurationId 为空时返回空串。
 */
function activeConfigurationUri(settings: Record<string, unknown>): string {
    const id = typeof settings.activeConfigurationId === "string" ? settings.activeConfigurationId.trim() : "";
    if (!id) return "";
    const configurations = isRecord(settings.remoteConfigurations) ? settings.remoteConfigurations : null;
    if (!configurations) return "";
    const profile = configurations[id];
    if (!isRecord(profile)) return "";
    return typeof profile.uri === "string" ? profile.uri.trim() : "";
}

/**
 * 某个连接串是否指向官方 OsyC 端点域（例如 `sls+https://osyc3.sacu3.cn:…`）。
 *
 * 覆盖两种输入：LiveSync 连接串（`sls+https://…`，用真实 parser 取出
 * `couchDB_URI`）与普通 URL。解析失败 / 拿不到主机名一律返回 false ——
 * 判定必须保守，绝不把手动自建的远端误判成官方端点。
 */
export function isOfficialOsycEndpoint(uri: unknown): boolean {
    const raw = typeof uri === "string" ? uri.trim() : "";
    if (!raw) return false;
    let target = raw;
    try {
        const parsed = ConnectionStringParser.parse(raw);
        if (parsed.type === "couchdb") {
            const couchDB_URI = parsed.settings.couchDB_URI;
            if (typeof couchDB_URI === "string" && couchDB_URI.trim()) target = couchDB_URI.trim();
        }
    } catch {
        // 不是 LiveSync 连接串：仍然尝试按普通 URL 提取主机名。
    }
    let host = "";
    try {
        host = new URL(target).hostname.toLowerCase();
    } catch {
        const matched = target.match(/^[a-z0-9+.-]+:\/\/(?:[^@/]*@)?([^/?#:]+)/i);
        host = matched ? matched[1].toLowerCase() : "";
    }
    if (!host) return false;
    return OSYC_OFFICIAL_ENDPOINT_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 判断这份配置是不是「OsyC 自己签发的远端」。
 *
 * 三个来源**任一**成立即可（2.0.18 按现场反馈放宽）：
 * 1. `isConfigured === true`：配置已由激活流程完成；
 * 2. `couchDB_USER` 是 provisioner 的 `osyc_sync_*` 账号；
 * 3. 活动档案（或顶层 `couchDB_URI`）指向官方端点域。
 *
 * 旧版要求三条同时成立，真实设备上 `activeConfigurationId` / 档案形态一多就
 * 全部漏判 —— 于是 customChunkSize=60 一直没纠正、复制器静默中止。改为 OR 后
 * 只要签名对得上就修；判定本身仍保守（拿不到证据的不动）。
 */
export function isOsycProvisionedRemote(settings: Record<string, unknown>): boolean {
    if (settings.isConfigured === true) return true;
    const user = typeof settings.couchDB_USER === "string" ? settings.couchDB_USER.trim().toLowerCase() : "";
    if (user.startsWith(OSYC_SYNC_USER_PREFIX)) return true;
    if (isOfficialOsycEndpoint(activeConfigurationUri(settings))) return true;
    return isOfficialOsycEndpoint(settings.couchDB_URI);
}

/**
 * 是否**确实指向官方托管远端** —— 对 incompatible tweak 键（尤其 encrypt）自动对齐的唯一许可。
 *
 * ## 为什么不直接用 isOsycProvisionedRemote
 *
 * 那个函数的第一个分支是 `isConfigured === true`。它作为「窄补丁自愈」的许可足够了
 * （最坏也只是把 customChunkSize 改回基线），但作为「**自动关掉本机 E2EE**」的许可就太宽：
 * 任何已完成过配置、却把远端换成自建 CouchDB 的设备也会被判为 OsyC 远端，
 * 用户会在不知情的情况下被改掉加密设置。
 *
 * 所以这里只认两个**硬证据**（与需求里写的判定完全一致）：
 * 1. `couchDB_USER` 是 provisioner 的 `osyc_sync_*` 账号；
 * 2. 活动档案（或顶层 `couchDB_URI`）指向官方端点域。
 *
 * 拿不到硬证据 → 返回 false → 只提示，不自动改。
 */
export function isOfficialManagedRemote(settings: Record<string, unknown>): boolean {
    const user = typeof settings.couchDB_USER === "string" ? settings.couchDB_USER.trim().toLowerCase() : "";
    if (user.startsWith(OSYC_SYNC_USER_PREFIX)) return true;
    if (isOfficialOsycEndpoint(activeConfigurationUri(settings))) return true;
    return isOfficialOsycEndpoint(settings.couchDB_URI);
}

/** 活动档案能否解析为 couchdb 远端（补 remoteType 的前提）。 */
function isCouchDbConfiguration(settings: Record<string, unknown>): boolean {
    const uri = activeConfigurationUri(settings);
    if (!uri) return false;
    try {
        return ConnectionStringParser.parse(uri).type === "couchdb";
    } catch {
        return false;
    }
}

/**
 * 规划自愈补丁。纯函数，方便单测。
 *
 * 安全阀已按 2.0.17 现场反馈放宽为「三个来源任一成立即视为 OsyC 远端」
 * （见 {@link isOsycProvisionedRemote}）。判定成立后**无条件**按下述缺陷签名补齐：
 * - `liveSync !== true` → 补 `liveSync: true`（2.0.11 前的载荷不含该键）；
 * - `customChunkSize === 60` → 改回 `0`。**精确匹配 60**，不是「任意非 0」：
 *   0 是正常基线，用户自配的其它值一律不动；
 * - `remoteType` 缺失 / 为 null / 是空白串，且活动档案可解析为 couchdb → 补上
 *   规范空串（{@link OSYC_COUCHDB_REMOTE_TYPE}）。已经是规范空串时不写。
 *
 * 都不需要修时返回 null（避免无谓写盘）；补丁只含这三个键，绝不整份替换。
 */
export function planProvisionedReplicationRepair(settings: SettingsShape | null | undefined): ReplicationRepair | null {
    if (!isRecord(settings)) return null;
    if (!isOsycProvisionedRemote(settings)) return null;

    const repair: ReplicationRepair = {};
    if (settings.liveSync !== true) {
        repair.liveSync = true;
    }
    if (settings.customChunkSize === BUGGY_ACTIVATION_CHUNK_SIZE) {
        // 2.0.13 的激活补丁写下的缺陷值：改回 must-match 基线，让复制器不再 MISMATCHED。
        repair.customChunkSize = COMPATIBLE_CHUNK_SIZE_BASELINE;
    }
    const currentRemoteType = settings.remoteType;
    const remoteTypeNeedsFix =
        currentRemoteType !== OSYC_COUCHDB_REMOTE_TYPE &&
        (currentRemoteType === undefined ||
            currentRemoteType === null ||
            (typeof currentRemoteType === "string" && currentRemoteType.trim() === ""));
    if (remoteTypeNeedsFix && isCouchDbConfiguration(settings)) {
        repair.remoteType = OSYC_COUCHDB_REMOTE_TYPE;
    }
    if (
        repair.liveSync === undefined &&
        repair.customChunkSize === undefined &&
        repair.remoteType === undefined
    ) {
        return null;
    }
    return repair;
}

/** 把补丁翻成可直接进日志 / Notice 的中文改动清单（不含任何凭据）。 */
export function describeReplicationRepair(repair: ReplicationRepair): string[] {
    const changes: string[] = [];
    if (repair.liveSync === true) changes.push("补开 LiveSync 同步开关");
    if (repair.customChunkSize !== undefined) changes.push(`纠正 customChunkSize 为 ${repair.customChunkSize}`);
    if (repair.remoteType !== undefined) changes.push("补上 remoteType 为 couchdb");
    return changes;
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
