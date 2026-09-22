/**
 * must-match tweak 键的写入门禁 —— 把「同类故障不要再犯」变成机械保证。
 *
 * ## 要防的缺陷
 *
 * 2.0.13 的激活补丁单方面把 customChunkSize 写成 60，而 commonlib 的
 * must-match 模板基线（TweakValuesShouldMatchedTemplate.customChunkSize）是 0。
 * 只要远端里程碑的 PREFERRED 还是 0，复制器在 ensureDatabaseIsCompatible() 里
 * 就被判 MISMATCHED 并**在连接前中止** —— 服务端完全不可见，只有本机面板报
 * 「拉取失败」，一直漏到 2.0.18/2.0.19 才修。
 *
 * ## 不变量
 *
 * 我们代码写入的任何一个 must-match 键，其取值必须满足二者之一：
 *   1. 等于 commonlib 模板基线；或
 *   2. 等于远端 PREFERRED 的对齐结果（即来自 planTweakAlignment / alignedValues）。
 *
 * 换句话说：**禁止单方面写一个与基线不同的 tweak 值。** 本模块只做判定，
 * 不改任何现有行为；调用方（单测）据此把缺陷挡在代码评审之前。
 */

import { TweakValuesShouldMatchedTemplate } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";

/** 该键是否属于 commonlib 的 must-match 模板（不手工抄写键表）。 */
export function isMustMatchTweakKey(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(TweakValuesShouldMatchedTemplate, key);
}

/** 模板基线值；非 must-match 键返回 undefined。 */
export function mustMatchBaselineFor(key: string): unknown {
    return (TweakValuesShouldMatchedTemplate as unknown as Record<string, unknown>)[key];
}

/** 一条「单方面偏离基线」的违规记录，字段足够定位到具体是哪一处。 */
export interface TweakBaselineViolation {
    key: string;
    /** 补丁实际写入的值。 */
    value: unknown;
    /** commonlib 模板基线。 */
    baseline: unknown;
    /** 远端 PREFERRED 的对齐值（若有）。 */
    aligned: unknown;
    reason: string;
}

function isWritableSource(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 找出一份补丁里所有「单方面偏离 must-match 基线」的键。
 *
 * @param patch 我们代码准备写入 LiveSync 设置的补丁。
 * @param preferredAlignedValues 远端 PREFERRED 对齐后的取值集合；来自它的值合法。
 * @returns 违规列表；为空即通过门禁。
 */
export function findTweakBaselineViolations(
    patch: unknown,
    preferredAlignedValues?: Readonly<Record<string, unknown>> | null
): TweakBaselineViolation[] {
    if (!isWritableSource(patch)) return [];
    const aligned = isWritableSource(preferredAlignedValues) ? preferredAlignedValues : {};
    const violations: TweakBaselineViolation[] = [];
    for (const [key, value] of Object.entries(patch)) {
        if (!isMustMatchTweakKey(key)) continue;
        if (value === undefined) continue;
        const baseline = mustMatchBaselineFor(key);
        // 与 commonlib 的 isObjectDifferent(..., true) 一致：忽略 undefined。
        if (!isObjectDifferent(value, baseline, true)) continue;
        if (Object.prototype.hasOwnProperty.call(aligned, key)) {
            const alignedValue = aligned[key];
            if (!isObjectDifferent(value, alignedValue, true)) continue;
        }
        violations.push({
            key,
            value,
            baseline,
            aligned: aligned[key],
            reason:
                "must-match 键 " +
                key +
                " 被单方面写成 " +
                JSON.stringify(value) +
                "，既不是模板基线 " +
                JSON.stringify(baseline) +
                "，也不是远端 PREFERRED 的对齐结果（" +
                JSON.stringify(aligned[key] ?? null) +
                "）",
        });
    }
    return violations;
}

/**
 * 门禁断言：任何违规直接抛错，错误信息精确到键、写入值与基线。
 *
 * @param context 出现违规的代码位置说明（例如 "激活补丁 buildSetupPatch"）。
 */
export function assertNoTweakBaselineViolations(
    patch: unknown,
    preferredAlignedValues?: Readonly<Record<string, unknown>> | null,
    context = "补丁"
): void {
    const violations = findTweakBaselineViolations(patch, preferredAlignedValues);
    if (violations.length === 0) return;
    throw new Error(
        context + " 单方面写入 must-match 键：" + violations.map((violation) => violation.reason).join("；")
    );
}
