import {
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

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
    const applied: Record<string, unknown> = {};
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
        applied[key] = value;
    }

    return {
        applied: applied as Partial<ObsidianLiveSyncSettings>,
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
    } as Partial<ObsidianLiveSyncSettings>;
}
