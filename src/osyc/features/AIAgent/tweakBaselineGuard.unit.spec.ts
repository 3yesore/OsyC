/**
 * Task B 回归门禁：must-match tweak 键不得被单方面写偏。
 *
 * 背景：2.0.13 的激活补丁把 customChunkSize 写成 60（模板基线 0），远端 PREFERRED
 * 还是 0，复制器在 ensureDatabaseIsCompatible() 里 MISMATCHED 并在连接前中止，
 * 服务端完全不可见。本文件把「我们代码写出的任何 must-match 键，要么等于模板基线，
 * 要么来自远端 PREFERRED 的对齐结果」固定成机械断言；键表一律来自 commonlib /
 * tweakAlignment.ts，不手工抄写。
 *
 * ## 已经发现并上报的既有偏离（本次不顺手改行为，只精确钉住）
 *
 * buildSetupPatch 会把 setup_uri 载荷里的 usePluginSyncV2 原样透传，而它在
 * TweakValuesShouldMatchedTemplate 里的基线是 false；OsyC 下发的载荷是 true。
 * 也就是说 buildSetupPatch 当前确实写出一个「既非基线、也非远端 PREFERRED」的
 * must-match 值。这属于同一类缺陷的候选，但不在本次改动范围内：下面的测试把它
 * 钉成「唯一已知偏离」，好让任何新增偏离（例如 customChunkSize=60）立即 FAIL，
 * 并把位置精确报出来。
 */
import { describe, expect, it } from "vitest";
import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import type { CouchDBConnection } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    TweakValuesDefault,
    TweakValuesShouldMatchedTemplate,
} from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import { buildSetupPatch, planCouchDbRemoteConfigurationReroute } from "./livesyncPatch";
import { planProvisionedReplicationRepair } from "./livesyncActivation";
import { TWEAK_ALIGNMENT_KEYS, planTweakAlignment } from "./tweakAlignment";
import {
    assertNoTweakBaselineViolations,
    findTweakBaselineViolations,
    isMustMatchTweakKey,
    mustMatchBaselineFor,
} from "./tweakBaselineGuard";

/** 后端 setup_uri 实际下发的载荷：只含身份类键，不含 liveSync / remoteType / 分块参数。 */
const SETUP_PAYLOAD: Record<string, unknown> = {
    couchDB_URI: "https://sync.example.com",
    couchDB_USER: "osyc_sync_abc",
    couchDB_PASSWORD: "x".repeat(64),
    couchDB_DBNAME: "t_abc",
    isConfigured: true,
    usePluginSyncV2: true,
    configPassphraseStore: "",
    encryptedCouchDBConnection: "",
    encryptedPassphrase: "",
};

/**
 * 已知且已上报的偏离键：buildSetupPatch 透传载荷里的 usePluginSyncV2（基线 false）。
 * 只有这一个键允许出现在 buildSetupPatch 违规列表里。
 */
const KNOWN_SETUP_PATCH_DEVIATION = "usePluginSyncV2";

/** must-match 模板 + 默认值补齐：与 planTweakAlignment 内部口径一致的完整基线。 */
function baseTweaks(): Record<string, unknown> {
    return { ...TweakValuesShouldMatchedTemplate, ...TweakValuesDefault } as Record<string, unknown>;
}

/** 造一个与基线不同的值（布尔取反 / 数字 +1 / 字符串换名）。 */
function mutateTweak(key: string, base: Record<string, unknown>): Record<string, unknown> {
    const value = base[key];
    const next: Record<string, unknown> = { ...base };
    if (typeof value === "boolean") next[key] = !value;
    else if (typeof value === "number") next[key] = value + 1;
    else next[key] = "DIFFERENT_VALUE";
    return next;
}

/** 用真实 ConnectionStringParser 造一个 couchdb 档案 uri（让 remoteType 补齐分支可达）。 */
function couchDbUri(): string {
    return ConnectionStringParser.serialize({
        type: "couchdb",
        settings: {
            couchDB_URI: "https://osyc3.sacu3.cn",
            couchDB_USER: "osyc_sync_testuser",
            couchDB_PASSWORD: "secret-pass",
            couchDB_DBNAME: "t_testdb",
            couchDB_CustomHeaders: "",
            useJWT: false,
            jwtAlgorithm: "HS256",
            jwtKey: "",
            jwtKid: "",
            jwtSub: "",
            jwtExpDuration: 5,
            useRequestAPI: true,
        } as unknown as CouchDBConnection,
    });
}

describe("tweak 基线门禁：键表来源与基本口径", () => {
    it("键表直接来自 commonlib 模板（18 个），不手工抄写", () => {
        expect(Object.keys(TweakValuesShouldMatchedTemplate)).toHaveLength(18);
        for (const key of TWEAK_ALIGNMENT_KEYS) {
            expect(isMustMatchTweakKey(key), key).toBe(true);
        }
        // 复制器开关 / 远端类型不是 must-match 键：门禁不得把它们误判成违规。
        expect(isMustMatchTweakKey("liveSync")).toBe(false);
        expect(isMustMatchTweakKey("remoteType")).toBe(false);
        expect(mustMatchBaselineFor("customChunkSize")).toBe(0);
    });

    it("阴：与基线相同的补丁放行；偏离基线的补丁报出精确的键", () => {
        const clean = { customChunkSize: mustMatchBaselineFor("customChunkSize"), liveSync: true };
        expect(findTweakBaselineViolations(clean)).toEqual([]);
        const violations = findTweakBaselineViolations({ customChunkSize: 60, liveSync: true });
        expect(violations.map((violation) => violation.key)).toEqual(["customChunkSize"]);
        expect(violations[0]).toMatchObject({ key: "customChunkSize", value: 60, baseline: 0 });
    });
});

describe("门禁覆盖：所有会写 must-match 键的补丁输出", () => {
    it("buildSetupPatch 只有唯一的已知偏离 usePluginSyncV2（基线 false，来自 setup_uri 透传）", () => {
        const patch = buildSetupPatch(SETUP_PAYLOAD) as Record<string, unknown>;
        const violations = findTweakBaselineViolations(patch);
        // 精确钉住位置：键、实际值、基线。任何新增/变化的偏离都会在这里立刻暴露。
        expect(violations.map((violation) => violation.key)).toEqual([KNOWN_SETUP_PATCH_DEVIATION]);
        expect(violations[0]).toMatchObject({
            key: KNOWN_SETUP_PATCH_DEVIATION,
            value: true,
            baseline: false,
            aligned: undefined,
        });
        expect(violations[0].reason).toContain("usePluginSyncV2");
        expect(violations[0].reason).toContain("false");
    });

    it("空载荷与畸形开关下 buildSetupPatch 不新增任何 must-match 偏离", () => {
        // 空载荷没有 usePluginSyncV2：必须零违规。
        expect(findTweakBaselineViolations(buildSetupPatch({}) as Record<string, unknown>)).toEqual([]);
        // 含载荷的畸形变体：只允许已上报的那一个已知偏离。
        const payloads: Record<string, unknown>[] = [
            { ...SETUP_PAYLOAD, liveSync: false },
            { ...SETUP_PAYLOAD, remoteType: "minio" },
            { ...SETUP_PAYLOAD, isConfigured: false },
        ];
        for (const payload of payloads) {
            const patch = buildSetupPatch(payload) as Record<string, unknown>;
            expect(findTweakBaselineViolations(patch).map((violation) => violation.key)).toEqual([
                KNOWN_SETUP_PATCH_DEVIATION,
            ]);
        }
    });

    it("激活补丁的最终输出（buildSetupPatch + 档案改写）同样只有这一个已知偏离", () => {
        const reroute = planCouchDbRemoteConfigurationReroute(SETUP_PAYLOAD, {
            remoteConfigurations: {},
            activeConfigurationId: "",
        });
        expect(reroute.changed).toBe(true);
        const merged: Record<string, unknown> = {
            ...(buildSetupPatch(SETUP_PAYLOAD) as Record<string, unknown>),
            remoteConfigurations: reroute.remoteConfigurations,
            activeConfigurationId: reroute.activeConfigurationId,
        };
        expect(findTweakBaselineViolations(merged).map((violation) => violation.key)).toEqual([
            KNOWN_SETUP_PATCH_DEVIATION,
        ]);
        // 档案改写本身不引入任何新的 must-match 键。
        expect(findTweakBaselineViolations(reroute.remoteConfigurations as unknown as Record<string, unknown>)).toEqual(
            []
        );
    });

    it("planProvisionedReplicationRepair 的输出不单方面偏离基线（含 2.0.13 缺陷签名自愈）", () => {
        const states: Record<string, unknown>[] = [
            { isConfigured: true, liveSync: false, customChunkSize: 60 },
            { isConfigured: true, liveSync: true, customChunkSize: 60 },
            { isConfigured: true, liveSync: true, customChunkSize: 0 },
            { couchDB_USER: "osyc_sync_abc", liveSync: true, customChunkSize: 60 },
            {
                isConfigured: true,
                liveSync: true,
                remoteType: undefined,
                customChunkSize: 60,
                activeConfigurationId: "legacy-couchdb",
                remoteConfigurations: {
                    "legacy-couchdb": {
                        id: "legacy-couchdb",
                        name: "CouchDB Remote",
                        uri: couchDbUri(),
                        isEncrypted: false,
                    },
                },
            },
            {},
        ];
        for (const state of states) {
            const repair = planProvisionedReplicationRepair(state) as Record<string, unknown> | null;
            expect(findTweakBaselineViolations(repair)).toEqual([]);
            expect(() =>
                assertNoTweakBaselineViolations(repair, undefined, "自愈 planProvisionedReplicationRepair")
            ).not.toThrow();
        }
    });
});

describe("门禁与远端 PREFERRED 对齐的关系", () => {
    it("来自远端 PREFERRED 的值合法；同一个值脱离 PREFERRED 就违规", () => {
        // 远端自己把 customChunkSize 存成 60（非模板基线），本机是 0：
        // 对齐写入 60 是「来自远端 PREFERRED」的结果，必须放行。
        const remotePreferred: Record<string, unknown> = { ...baseTweaks(), customChunkSize: 60 };
        const plan = planTweakAlignment({ ...baseTweaks(), customChunkSize: 0 }, remotePreferred);
        expect(plan.silentPatch).toEqual({ customChunkSize: 60 });
        expect(findTweakBaselineViolations(plan.silentPatch, remotePreferred)).toEqual([]);
        // 同一个补丁，拿不到远端 PREFERRED 证据时，就是单方面写偏 —— 必须报违规。
        expect(findTweakBaselineViolations(plan.silentPatch).map((violation) => violation.key)).toEqual([
            "customChunkSize",
        ]);
    });

    it("自愈/对齐覆盖全部 18 个 must-match 键（键表来自 TWEAK_ALIGNMENT_KEYS）", () => {
        expect(TWEAK_ALIGNMENT_KEYS).toEqual(Object.keys(TweakValuesShouldMatchedTemplate));
        expect(TWEAK_ALIGNMENT_KEYS).toHaveLength(18);
        for (const key of TWEAK_ALIGNMENT_KEYS) {
            const base = baseTweaks();
            const remotePreferred = mutateTweak(key, base);
            const plan = planTweakAlignment(base, remotePreferred);
            expect(
                plan.diffs.map((diff) => diff.key),
                key
            ).toEqual([key]);
            expect(plan.alignedValues[key], key).toEqual(remotePreferred[key]);
            // 对齐结果来自远端 PREFERRED，门禁必须放行。
            expect(findTweakBaselineViolations(plan.alignedValues, remotePreferred), key).toEqual([]);
        }
    });
});

describe("阴性对照：把 customChunkSize 改成 60（只在内存里构造）门禁必须 FAIL", () => {
    it("篡改后的补丁多出一条精确指向 customChunkSize 的违规，未篡改的补丁保持已知状态", () => {
        const clean = buildSetupPatch(SETUP_PAYLOAD) as Record<string, unknown>;
        const tampered: Record<string, unknown> = { ...clean, customChunkSize: 60 };
        const cleanViolations = findTweakBaselineViolations(clean);
        const violations = findTweakBaselineViolations(tampered);
        // 只改内存对象，不改任何文件；原始输出留给报告。
        console.log("[task-b negative-control] clean violations:", JSON.stringify(cleanViolations));
        console.log("[task-b negative-control] tampered patch keys:", JSON.stringify(Object.keys(tampered)));
        console.log("[task-b negative-control] tampered violations:", JSON.stringify(violations, null, 2));
        // 未篡改时只有已上报的 usePluginSyncV2。
        expect(cleanViolations.map((violation) => violation.key)).toEqual([KNOWN_SETUP_PATCH_DEVIATION]);
        // 篡改后必须多出 customChunkSize，且值/基线精确可辨。
        expect(violations.map((violation) => violation.key)).toEqual([KNOWN_SETUP_PATCH_DEVIATION, "customChunkSize"]);
        const chunkViolation = violations.find((violation) => violation.key === "customChunkSize");
        expect(chunkViolation).toMatchObject({ key: "customChunkSize", value: 60, baseline: 0 });
        expect(() => assertNoTweakBaselineViolations(tampered, undefined, "激活补丁 buildSetupPatch")).toThrow(
            /customChunkSize/
        );
        // 门禁不是恒 FAIL 的摆设：一份完全贴合基线的补丁必须放行。
        const baselineOnly: Record<string, unknown> = { customChunkSize: 0, hashAlg: "xxhash64", liveSync: true };
        expect(findTweakBaselineViolations(baselineOnly)).toEqual([]);
        expect(() => assertNoTweakBaselineViolations(baselineOnly, undefined, "基线补丁")).not.toThrow();
    });
});
