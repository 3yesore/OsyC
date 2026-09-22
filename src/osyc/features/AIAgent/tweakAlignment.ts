/**
 * 跨设备 tweak（同步参数）差异计算 —— 纯逻辑，可在 Node 下单测。
 *
 * ## 为什么需要这一层
 *
 * 2026-10 生产事故（租户 3YESORE-CENTCOLYS）：iOS 设备（插件 2.0.18，vault
 * Learning-Vault）与 Windows 设备（2.0.17，vault learning）都能握手，但复制器在
 * commonlib 的 ensureDatabaseIsCompatible() 里被判 MISMATCHED 后**直接中止**：
 *
 * - iOS 的唯一差异是 encrypt: true（本机）vs 远端 PREFERRED false；
 * - Windows 的唯一差异是 customChunkSize: 60（本机）vs PREFERRED 0。
 *
 * 而 2.0.18 的「修复同步配置」只认 customChunkSize / remoteType 两个缺陷签名，
 * 于是 iOS 用户点下去得到的是「同步配置已是最新，无需修复」—— 复制其实被 encrypt
 * 硬性阻断。用户被指向了一条不存在的出路，这就是本模块要消除的产品缺陷。
 *
 * ## 判定必须与 commonlib 完全一致
 *
 * ensureRemoteIsCompatible 的真实判定是：对远端 PREFERRED 与本机设置各自做
 * extractObject(TweakValuesShouldMatchedTemplate, { ...TweakValuesDefault, ...values }) ，
 * 再用 isObjectDifferent(..., true)（**ignoreUndefined = true**）比较。
 * 因此本模块逐键比较时也必须是「任一侧为 undefined 的键不参与判定」，否则会把
 * LiveSync 根本不会判 mismatch 的键误报成差异，制造新的误诊。
 *
 * ## 分级规则
 *
 * - compatible-lossy：hashAlg / customChunkSize / chunkSplitterVersion ——
 *   静默对齐到云端 PREFERRED 并写回设置。
 * - incompatible：commonlib 的 IncompatibleChanges（encrypt / usePathObfuscation /
 *   useDynamicIterationCount / handleFilenameCaseSensitive）以及其余未归类的
 *   must-match 键 —— **禁止静默改写**，必须由用户显式确认后按 LiveSync 自己的
 *   重建路径（core.rebuilder.$fetchLocal()）对齐。
 *
 * 只要存在任何一条 incompatible 差异，requiresUserConfirmation 就为 true；
 * 调用方在任何情况下都不得宣称「同步配置已是最新」。
 */

import {
    CompatibleButLossyChanges,
    TweakValuesDefault,
    TweakValuesShouldMatchedTemplate,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { FORBIDDEN_KEYS } from "./livesyncPatch";

/** 差异分级：compatible-lossy 可静默对齐；incompatible 必须用户确认。 */
export type TweakAlignmentKind = "compatible-lossy" | "incompatible";

/** 单条差异：键、本机值、云端 PREFERRED 值、分级。 */
export interface TweakAlignmentDiff {
    key: string;
    local: unknown;
    preferred: unknown;
    kind: TweakAlignmentKind;
}

/**
 * 计算选项。
 *
 * allowIncompatibleAutoAlign 只允许在**官方托管远端**上置 true：
 * 那类远端由 OsyC 自己签发、固定明文（encrypt=false），用户不该为它的参数手动操作。
 * 自建 / 非托管远端必须保持 false —— 我们无权替用户决定关掉他自己的 E2EE。
 */
export interface TweakAlignmentOptions {
    allowIncompatibleAutoAlign?: boolean;
}

/** 只有官方托管远端才允许对 incompatible 键（尤其 encrypt）自动对齐。 */
export function tweakAlignmentOptionsForRemote(isOfficialManagedRemote: boolean): TweakAlignmentOptions {
    return { allowIncompatibleAutoAlign: isOfficialManagedRemote === true };
}

export interface TweakAlignmentPlan {
    /** 是否真的读到了远端 PREFERRED；false 时 noop 也一定是 false（没证据就不许说无差异）。 */
    available: boolean;
    /** 唯一可信的 no-op 判据：读到了远端 PREFERRED 且逐键全等。 */
    noop: boolean;
    diffs: TweakAlignmentDiff[];
    incompatible: TweakAlignmentDiff[];
    compatibleLossy: TweakAlignmentDiff[];
    /** 只含 compatible-lossy 键的静默对齐补丁。 */
    silentPatch: Record<string, unknown>;
    /** 全部差异键对齐到云端后的值（用户确认后一次性写入）。 */
    alignedValues: Record<string, unknown>;
    /** 存在 incompatible 差异时必须为 true：不得静默改写。 */
    requiresUserConfirmation: boolean;
    /**
     * 全部差异（含 incompatible）都可以自动对齐。
     *
     * 只有 allowIncompatibleAutoAlign 为 true 且确实存在差异时为 true；
     * 调用方此时应静默执行 alignedValues，不再向用户索要确认。
     */
    autoAlign: boolean;
}

/**
 * must-match 的 18 个键。
 *
 * 直接取自 commonlib 的 TweakValuesShouldMatchedTemplate，顺序也保持一致，
 * 保证与复制器判定的是同一份键表（不手工抄写，避免版本漂移）。
 */
export const TWEAK_ALIGNMENT_KEYS: readonly string[] = Object.freeze(
    Object.keys(TweakValuesShouldMatchedTemplate)
);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 复刻 ensureRemoteIsCompatible 的取值：先合并 TweakValuesDefault，
 * 再只保留 must-match 的 18 个键。
 *
 * 注意 extractObject 会用源对象的值**覆盖**模板默认值（即使源里是 undefined），
 * 所以这里用展开合并即可得到与 commonlib 一致的结果。
 */
function shouldMatchedView(source: unknown): Record<string, unknown> {
    const merged: Record<string, unknown> = {
        ...(TweakValuesDefault as Record<string, unknown>),
        ...(isRecord(source) ? source : {}),
    };
    const view: Record<string, unknown> = {};
    for (const key of TWEAK_ALIGNMENT_KEYS) view[key] = merged[key];
    return view;
}

/**
 * 键的分级。
 *
 * CompatibleButLossyChanges 的三个键可静默对齐；其余全部按 incompatible 处理
 * （包含 commonlib IncompatibleChanges 的四个键，以及未归类的 must-match 键）。
 * 未归类的键也要求确认，是因为静默改写它们同样可能丢数据 —— 保守侧永远是安全侧。
 */
export function classifyTweakKey(key: string): TweakAlignmentKind {
    return (CompatibleButLossyChanges as string[]).indexOf(key) !== -1 ? "compatible-lossy" : "incompatible";
}

function buildPlan(
    available: boolean,
    diffs: TweakAlignmentDiff[],
    options: TweakAlignmentOptions
): TweakAlignmentPlan {
    const incompatible = diffs.filter((diff) => diff.kind === "incompatible");
    const compatibleLossy = diffs.filter((diff) => diff.kind === "compatible-lossy");
    const autoAlign = available && options.allowIncompatibleAutoAlign === true && diffs.length > 0;
    return {
        available,
        noop: available && diffs.length === 0,
        diffs,
        incompatible,
        compatibleLossy,
        silentPatch: Object.fromEntries(compatibleLossy.map((diff) => [diff.key, diff.preferred])),
        alignedValues: Object.fromEntries(diffs.map((diff) => [diff.key, diff.preferred])),
        // 官方托管远端自动对齐时不再索要确认；自建 / 非托管远端仍然只提示。
        requiresUserConfirmation: incompatible.length > 0 && !autoAlign,
        autoAlign,
    };
}

/**
 * 计算本机设置与云端 PREFERRED 的全部 must-match 差异。
 *
 * @param localSettings LiveSync 设置对象（本机）。
 * @param remotePreferred 远端里程碑 tweak_values.PREFERRED；读不到时传 null / undefined。
 * @returns 分级后的差异计划；差异为空且确实读到了远端时才是真正的 no-op。
 */
export function planTweakAlignment(
    localSettings: unknown,
    remotePreferred: unknown,
    options: TweakAlignmentOptions = {}
): TweakAlignmentPlan {
    if (!isRecord(remotePreferred)) return buildPlan(false, [], options);
    const local = shouldMatchedView(localSettings);
    const preferred = shouldMatchedView(remotePreferred);
    const diffs: TweakAlignmentDiff[] = [];
    for (const key of TWEAK_ALIGNMENT_KEYS) {
        const localValue = local[key];
        const preferredValue = preferred[key];
        // 与 isObjectDifferent(..., true) 一致：任一侧 undefined 的键 LiveSync 不视为差异。
        if (localValue === undefined || preferredValue === undefined) continue;
        if (!isObjectDifferent(localValue, preferredValue, true)) continue;
        diffs.push({
            key,
            local: localValue,
            preferred: preferredValue,
            kind: classifyTweakKey(key),
        });
    }
    return buildPlan(true, diffs, options);
}

/**
 * 安全边界：自动对齐只写 tweak 键，**绝不**写身份类 / 凭据类。
 *
 * 即使对官方托管远端全自动，passphrase / encryptedPassphrase /
 * encryptedCouchDBConnection / 各类远端凭据也一律不落笔 —— 它们只能由激活流程
 * （后端用卡密加密下发的 setup URI）设置。FORBIDDEN_KEYS 与 livesyncPatch 共用同一份。
 */
export function filterAlignmentPatch(values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        if (FORBIDDEN_KEYS.has(key as keyof ObsidianLiveSyncSettings)) continue;
        out[key] = value;
    }
    return out;
}

/** 把任意值折成可展示的标量。 */
export function describeTweakValue(value: unknown): string {
    if (value === undefined) return "未设置";
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return value === "" ? "（空串）" : value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "非数字";
    return serialiseTweakValue(value, "（无法序列化的值）");
}

/**
 * 序列化非标量值。
 *
 * 不用 String(value)：对普通对象它会得到 "[object Object]"，既丢信息又会被
 * @typescript-eslint/no-base-to-string 拦下。这里显式 JSON 化，失败时给固定兜底文案。
 */
function serialiseTweakValue(value: unknown, fallback: string): string {
    try {
        const json = JSON.stringify(value);
        if (typeof json === "string") return json;
    } catch {
        // 循环引用等无法序列化的情况走兜底。
    }
    return fallback;
}

/** 诊断载荷里用的标量形式：尽量保留原始类型，其余一律转字符串。 */
export function toDiagnosticTweakValue(value: unknown): string | number | boolean | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    return serialiseTweakValue(value, "（无法序列化的值）");
}

/** 诊断载荷字段：键 → { local, preferred }。 */
export function buildTweakDiffRecord(
    diffs: readonly TweakAlignmentDiff[]
): Record<string, { local: string | number | boolean | null; preferred: string | number | boolean | null }> {
    const out: Record<
        string,
        { local: string | number | boolean | null; preferred: string | number | boolean | null }
    > = {};
    for (const diff of diffs) {
        out[diff.key] = {
            local: toDiagnosticTweakValue(diff.local),
            preferred: toDiagnosticTweakValue(diff.preferred),
        };
    }
    return out;
}

const TWEAK_KEY_LABELS_ZH: Record<string, string> = {
    minimumChunkSize: "最小分块大小",
    longLineThreshold: "长行阈值",
    encrypt: "端到端加密",
    usePathObfuscation: "路径混淆",
    enableCompression: "启用压缩",
    useEden: "启用 Eden 增量同步",
    customChunkSize: "自定义分块大小",
    useDynamicIterationCount: "动态迭代次数",
    hashAlg: "哈希算法",
    enableChunkSplitterV2: "启用分块器 V2",
    maxChunksInEden: "Eden 最大分块数",
    maxTotalLengthInEden: "Eden 最大总长度",
    maxAgeInEden: "Eden 最大保留时间",
    usePluginSyncV2: "插件同步 V2",
    handleFilenameCaseSensitive: "文件名大小写敏感",
    useSegmenter: "启用分词器",
    E2EEAlgorithm: "端到端加密算法",
    chunkSplitterVersion: "分块器版本",
};

/** 键的中文标签；未知键回退为原键名。 */
export function tweakKeyLabel(key: string): string {
    return TWEAK_KEY_LABELS_ZH[key] ?? key;
}

/** 逐条差异的中文描述，供日志与 Notice 使用。 */
export function describeTweakAlignment(plan: TweakAlignmentPlan): string[] {
    return plan.diffs.map(
        (diff) =>
            tweakKeyLabel(diff.key) +
            "（" + diff.key + "）：本机 " + describeTweakValue(diff.local) + " → 云端 " + describeTweakValue(diff.preferred)
    );
}

/** 差异涉及的键名列表（用于日志 / 诊断的稳定字符串）。 */
export function listTweakDiffKeys(plan: TweakAlignmentPlan): string[] {
    return plan.diffs.map((diff) => diff.key);
}

/** 是否存在端到端加密相关差异（决定确认文案走通用版还是 E2EE 专用版）。 */
export function hasEncryptDiff(plan: TweakAlignmentPlan): boolean {
    return plan.diffs.some((diff) => diff.key === "encrypt");
}

/**
 * 用户确认文案。
 *
 * encrypt 存在时给出端到端加密的专用说明 —— 这是真机上最容易让用户困惑的一条：
 * 本机开了 E2EE、云端是明文，与云端对齐就会关掉本机加密并重建本地库。
 */
export function buildTweakAlignWarning(plan: TweakAlignmentPlan): string {
    if (hasEncryptDiff(plan)) {
        return "本地开启了端到端加密，云端是明文，复制会被中止；与云端对齐会关闭本地 E2EE 并重建本地同步库（本地未同步内容会被云端覆盖）。";
    }
    const keys = listTweakDiffKeys(plan).join("、");
    return (
        "本地与云端的同步参数不一致（" +
        keys +
        "），复制会被中止；与云端对齐会按云端参数重建本地同步库（本地未同步内容会被云端覆盖）。"
    );
}
