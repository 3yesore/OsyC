import {
    DEFAULT_SETTINGS,
    type CouchDBConnection,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import type { RemoteConfiguration } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";

/**
 * LiveSync 设置的分级与合并式修改。
 *
 * ## 为什么必须分级
 *
 * LiveSync 的设置里有两类键，危险程度差着一个数量级：
 *
 * - **身份类**（远端地址、桶、凭据）：写错用户就**再也连不上自己的数据**，
 *   而且往往不知道发生了什么 —— 这是不可逆的灾难。
 * - **行为类**（批量保存、文件监听开关）：改错最多同步节奏不对，改回来就好。
 *
 * 所以规则只有一条：**身份类永远只能由激活流程（后端下发的 setup URI）设置，
 * 任何 agent / 自动流程都不得碰。** 行为类才允许调。
 *
 * ## 为什么用白名单而不是黑名单
 *
 * 白名单是"默认拒绝"：新版本 LiveSync 加了新设置键，默认不会被自动改到，
 * 只有我们显式登记后才开放。黑名单则会让新键默认可写 —— 迟早出事。
 */

/**
 * 身份类：改错会丢数据源，任何自动流程都不得写入。
 *
 * 这些键只有激活流程能设，且只来自后端用卡密加密下发的 setup URI。
 */
const FORBIDDEN_KEYS = new Set<keyof ObsidianLiveSyncSettings>([
    "couchDB_URI",
    "couchDB_USER",
    "couchDB_PASSWORD",
    "couchDB_DBNAME",
    "bucket",
    "region",
    "endpoint",
    "accessKey",
    "secretKey",
    "passphrase",
    "encryptedPassphrase",
    "encryptedCouchDBConnection",
] as unknown as (keyof ObsidianLiveSyncSettings)[]);

/**
 * 行为类：允许调整，改错了可恢复。
 *
 * 这里是 agent 唯一能动的键。新增可调项时登记在这里，并说明理由。
 */
const TUNABLE_KEYS = new Set<keyof ObsidianLiveSyncSettings>([
    // 批量保存：笔记多时减少写放大，代价是崩溃可能丢最后几秒的改动
    "batchSave",
    // 暂停文件监听：批量导入大量文件时先暂停，避免每个文件都触发一次同步
    "suspendFileWatching",
    // 是否监听 Obsidian 内部配置变化（.obsidian 目录）
    "watchInternalFileChanges",
    // 是否用 IndexedDB 适配器：移动端推荐开启，桌面端通常关闭
    "useIndexedDBAdapter",
    // 配置不匹配时是否检查：关掉能减少干扰弹窗，但也会掩盖真问题
    "disableCheckingConfigMismatch",
] as unknown as (keyof ObsidianLiveSyncSettings)[]);

export interface SanitizeResult {
    /** 通过校验、可以应用的键 */
    applied: Partial<ObsidianLiveSyncSettings>;
    /** 被拒绝的键及原因，用于回显给用户 —— 静默丢弃比报错更让人困惑 */
    rejected: { key: string; reason: string }[];
}

/**
 * 校验键是否允许写入。
 *
 * 类型基准取自 DEFAULT_SETTINGS，不必手工维护一张类型表 ——
 * LiveSync 升级改了字段类型，这里自动跟着变。
 */
function isAcceptableValue(key: string, value: unknown): boolean {
    if (value === null || value === undefined) {
        // 写 null 等于清空配置，一律拒绝
        return false;
    }
    const baseline = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    if (baseline === undefined || baseline === null) {
        return false;
    }
    if (Array.isArray(baseline)) {
        return Array.isArray(value);
    }
    if (typeof baseline === "boolean" || typeof baseline === "number" || typeof baseline === "string") {
        if (typeof value !== typeof baseline) return false;
        // 数值类不接受负值 / NaN：模型偶尔会编出负数间隔
        if (typeof baseline === "number") {
            const num = value as number;
            return Number.isFinite(num) && num >= 0;
        }
        return true;
    }
    return typeof value === typeof baseline;
}

/**
 * 把一份「想改的设置」过滤成安全的补丁。
 *
 * 三道过滤：身份类禁写 → 白名单 → 值类型校验。
 * 纯函数，不碰任何全局状态，方便单测。
 */
export function sanitizeLivesyncPatch(patch: Record<string, unknown>): SanitizeResult {
    const applied: Partial<ObsidianLiveSyncSettings> = {};
    const rejected: { key: string; reason: string }[] = [];

    for (const [key, value] of Object.entries(patch ?? {})) {
        if (FORBIDDEN_KEYS.has(key as keyof ObsidianLiveSyncSettings)) {
            rejected.push({
                key,
                reason: "远端地址与凭据属于数据源身份，不允许自动修改，请手动配置",
            });
            continue;
        }
        if (!TUNABLE_KEYS.has(key as keyof ObsidianLiveSyncSettings)) {
            rejected.push({ key, reason: "该设置不在允许调整的范围内" });
            continue;
        }
        if (!isAcceptableValue(key, value)) {
            rejected.push({ key, reason: "取值类型不合法" });
            continue;
        }
        (applied as Record<string, unknown>)[key] = value;
    }

    return {
        applied,
        rejected,
    };
}

/**
 * 合并激活流程下发的同步配置。
 *
 * 与 sanitize 不同：这里**允许**身份类键，因为同步目标本来就是后端下发的，
 * 这正是「输入卡密就自动配好同步」的实现。
 *
 * 但依然**不**以 DEFAULT_SETTINGS 打底 —— 那会把用户自己调过的其他偏好
 * （语言、主题、其他同步行为）全部重置成默认值。这是原先实现最大的坑。
 */
export function buildSetupPatch(decoded: Record<string, unknown>): Partial<ObsidianLiveSyncSettings> {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(decoded ?? {})) {
        if (value === null || value === undefined) continue;
        // 后端下发的配置同样做类型校验，防止畸形数据写坏设置
        if (!isAcceptableValue(key, value)) continue;
        patch[key] = value;
    }
    return {
        ...patch,
        isConfigured: true,
        // 同步引擎的总开关，必须由激活流程显式打开。
        //
        // setup_uri 的载荷只含身份类字段（couchDB_* / isConfigured /
        // usePluginSyncV2 / configPassphraseStore / encrypted*），**没有 liveSync**，
        // 而 LiveSync 的默认值是 false。复制器的启动条件是
        // `liveSync || syncOnStart`（ModuleReplicatorCouchDB._everyAfterResumeProcess），
        // 两个都是 false 时它根本不会打开 —— 表现为「激活成功、配置也写进去了，
        // 但一条笔记都不会上传，服务端 vault 永远是空的」。
        //
        // 这里放在最后而不是加进载荷：载荷由 commonlib 编码、改不了；
        // 且即使后端将来下发 false，激活的语义也应当是「打开同步」。
        liveSync: true,
    };
}


/**
 * 重写远程配置档案，使「激活流程写入的顶层端点」与「活动档案里的 uri」保持一致。
 *
 * ## 为什么必须动档案（根因）
 *
 * LiveSync（commonlib）2.x 的 `SettingService.loadSettings()` 在
 * `activeConfigurationId` 指向的 `remoteConfigurations[id]` 存在时，会调用内部的
 * `activateRemoteConfiguration(settings, id)`，用档案 uri 解析出的字段**覆盖**顶层的
 * `remoteType` 与 `couchDB_URI / couchDB_USER / couchDB_PASSWORD / couchDB_DBNAME`。
 * 而 `applyExternalSettings(partial)`（以及它调用的 `applyPartial`）只做
 * `{ ...settings, ...partial }` 的浅合并，**不会**碰 `remoteConfigurations`；
 * `adjustSettings()` 里的 `migrateLegacyRemoteConfigurationsInPlace` 也只在
 * `remoteConfigurations` 为空时才会从顶层字段重建档案。
 *
 * 结论：只写顶层 couchDB_* 字段的激活，在一台**已经有档案**的机器上必然被下次启动
 * 覆盖回旧端点。现场实测：客户端 data.json 里 `activeConfigurationId: "legacy-couchdb"`、
 * 档案 uri 指向旧的 `https://sync.sacu3.cn`，换了后端下发的 setup URI 也连不上新端点。
 *
 * ## 行为
 *
 * - `decoded` 必须同时给出非空的 couchDB_URI / USER / PASSWORD / DBNAME，否则原样返回、
 *   一个档案都不碰（`changed: false`）。
 * - 只重写 `type === "couchdb"` 的档案；S3 / P2P 档案原样保留，绝不让用户丢配置。
 * - `parse` 抛异常的坏档案原样保留，不会因为一条坏档案炸掉整个激活。
 * - 没有 couchdb 档案时把 `activeConfigurationId` 置空，交给下次启动的
 *   `migrateLegacyRemoteConfigurationsInPlace` 从新的顶层字段重建。
 * - 幂等：目标 uri 已经相同就不标记 `changed`，避免无谓写盘与 UI 提示。
 *
 * 纯函数，不碰任何全局状态，方便单测。
 */
export function planCouchDbRemoteConfigurationReroute(
    decoded: Record<string, unknown>,
    current: {
        remoteConfigurations?: Record<string, RemoteConfiguration>;
        activeConfigurationId?: string;
    },
): {
    remoteConfigurations: Record<string, RemoteConfiguration>;
    activeConfigurationId: string;
    changed: boolean;
} {
    const existing = current.remoteConfigurations ?? {};
    const originalActiveId =
        typeof current.activeConfigurationId === "string" ? current.activeConfigurationId : "";

    const requiredKeys = ["couchDB_URI", "couchDB_USER", "couchDB_PASSWORD", "couchDB_DBNAME"] as const;
    const targetIsComplete = requiredKeys.every(
        (key) => typeof decoded[key] === "string" && (decoded[key] as string).trim() !== ""
    );
    if (!targetIsComplete) {
        // 载荷不完整：无法确定新目标，原样返回、不碰任何档案。
        return { remoteConfigurations: existing, activeConfigurationId: originalActiveId, changed: false };
    }

    // serialize 需要完整设置对象：以 DEFAULT_SETTINGS 兜底，再依次覆盖「当前设置」与
    // 「解码结果」。这样缺失的可选 couchDB 字段（headers / JWT / requestAPI 等）
    // 不会变成 undefined 而破坏 uri。
    const mergedSettings = {
        ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
        ...(current as unknown as Record<string, unknown>),
        ...decoded,
    } as unknown as CouchDBConnection;

    const nextConfigurations: Record<string, RemoteConfiguration> = {};
    const couchDbIds: string[] = [];
    let changed = false;

    for (const [id, configuration] of Object.entries(existing)) {
        if (!configuration || typeof configuration !== "object" || typeof configuration.uri !== "string") {
            // 非预期数据：原样保留，绝不因为坏数据丢配置。
            if (configuration) nextConfigurations[id] = configuration;
            continue;
        }
        let parsed: ReturnType<typeof ConnectionStringParser.parse>;
        try {
            parsed = ConnectionStringParser.parse(configuration.uri);
        } catch {
            // 坏 uri（加密串或历史脏数据）：原样保留，不因一条坏档案炸掉整个激活。
            nextConfigurations[id] = configuration;
            continue;
        }
        if (parsed.type !== "couchdb") {
            // S3 / P2P：原样保留，绝不改。
            nextConfigurations[id] = configuration;
            continue;
        }
        couchDbIds.push(id);
        let uri = configuration.uri;
        try {
            // 明文 uri：同时把 isEncrypted 置回 false，否则下次启动解密会失败。
            uri = ConnectionStringParser.serialize({ type: "couchdb", settings: mergedSettings });
        } catch {
            // 目标设置本身无法序列化：保留旧 uri，至少不丢档案。
            nextConfigurations[id] = configuration;
            continue;
        }
        if (uri !== configuration.uri || configuration.isEncrypted !== false) {
            changed = true;
        }
        nextConfigurations[id] = { ...configuration, uri, isEncrypted: false };
    }

    let activeConfigurationId: string;
    if (couchDbIds.length === 0) {
        // 没有 couchdb 档案：清空活动档案，靠 migrateLegacyRemoteConfigurationsInPlace
        // 从新的顶层字段重建，避免下次启动被旧档案覆盖。
        activeConfigurationId = "";
    } else if (originalActiveId && couchDbIds.includes(originalActiveId)) {
        activeConfigurationId = originalActiveId;
    } else {
        // 原活动档案不是 couchdb（或为空）：切到第一个 couchdb 档案，保证新端点生效。
        activeConfigurationId = couchDbIds[0];
    }
    if (activeConfigurationId !== originalActiveId) changed = true;

    return { remoteConfigurations: nextConfigurations, activeConfigurationId, changed };
}
