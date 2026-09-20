import { describe, expect, it } from "vitest";

import { buildSetupPatch, sanitizeLivesyncPatch } from "@/osyc/features/AIAgent/livesyncPatch";
import {
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    DoctorRegulation,
    checkUnsuitableValues,
} from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";

/**
 * 激活流程写下去的同步配置必须能让复制器真正启动。
 *
 * 背景（2026-09-18 实测的生产故障）：setup_uri 的载荷由 commonlib 编码，
 * 只有 9 个身份类键，**不含 liveSync**；而 LiveSync 的默认值是 false。
 * `ModuleReplicatorCouchDB._everyAfterResumeProcess` 的启动条件是
 * `liveSync || syncOnStart` —— 两个都 false 就永远不打开复制。
 * 症状是「激活 HTTP 200、配置也写进去了，但 CouchDB 库里只有版本标记、
 * 一条笔记都没有」，服务端 vault 恒为空，AI 只能回答「没有找到任何笔记」。
 *
 * 所以这里把 liveSync 钉死：任何人删掉这一行，这组测试就会红。
 */
describe("buildSetupPatch：激活下发的同步配置", () => {
    const payload = {
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

    it("必须打开同步总开关 liveSync（否则复制器永不启动）", () => {
        const patch = buildSetupPatch(payload);
        expect(patch.liveSync).toBe(true);
    });

    it("必须标记 isConfigured", () => {
        const patch = buildSetupPatch(payload);
        expect(patch.isConfigured).toBe(true);
    });

    it("必须把 remoteType 钉成 CouchDB（遗留的 minio/p2p 会让复制器走错远端）", () => {
        expect(buildSetupPatch(payload).remoteType).toBe("");
        expect(buildSetupPatch({ ...payload, remoteType: "minio" }).remoteType).toBe("");
    });

    it("载荷里的身份类字段原样保留", () => {
        const patch = buildSetupPatch(payload);
        expect(patch.couchDB_URI).toBe("https://sync.example.com");
        expect(patch.couchDB_USER).toBe("osyc_sync_abc");
        expect(patch.couchDB_DBNAME).toBe("t_abc");
        expect(patch.couchDB_PASSWORD).toBe("x".repeat(64));
        expect(patch.usePluginSyncV2).toBe(true);
    });

    it("即使后端将来下发 liveSync=false，激活语义仍是打开同步", () => {
        const patch = buildSetupPatch({ ...payload, liveSync: false });
        expect(patch.liveSync).toBe(true);
    });

    it("空载荷也要给出可用的开关（不能让用户落到「配好了但不跑」）", () => {
        const patch = buildSetupPatch({});
        expect(patch.liveSync).toBe(true);
        expect(patch.isConfigured).toBe(true);
    });

    it("不认识的键被丢弃，不污染设置", () => {
        const patch = buildSetupPatch({ ...payload, notARealSetting: "boom" });
        expect("notARealSetting" in patch).toBe(false);
    });

    it("null / undefined 不写入（避免清空用户已有配置）", () => {
        const patch = buildSetupPatch({ ...payload, couchDB_USER: null });
        expect("couchDB_USER" in patch).toBe(false);
    });
});

describe("sanitizeLivesyncPatch：agent 不能碰同步开关", () => {
    it("拒绝 agent 修改 liveSync（开关只属于激活流程）", () => {
        const { applied, rejected } = sanitizeLivesyncPatch({ liveSync: true });
        expect("liveSync" in applied).toBe(false);
        expect(rejected.map((r) => r.key)).toContain("liveSync");
    });

    it("拒绝 agent 修改身份类字段", () => {
        const { applied, rejected } = sanitizeLivesyncPatch({ couchDB_URI: "https://evil.example.com" });
        expect("couchDB_URI" in applied).toBe(false);
        expect(rejected.map((r) => r.key)).toContain("couchDB_URI");
    });

    it("放行白名单里的行为类字段", () => {
        const { applied, rejected } = sanitizeLivesyncPatch({ batchSave: true });
        expect(applied.batchSave).toBe(true);
        expect(rejected).toHaveLength(0);
    });
});

/**
 * 激活写下去的分块参数必须与「配置诊断」（Doctor）规章一致。
 *
 * 背景（2026-09-20 真机验证）：setup_uri 的载荷由 commonlib 以
 * skipDefaultValue=true 编码，`customChunkSize` 因等于 schema 默认值 0 被整条剥掉，
 * 于是设备上留 0；而 DoctorRegulation 对「自建 CouchDB + v3-rabin-karp」要求 60。
 * 该规则的 `max` 被上游注释掉，而容差分支要求 `min` 与 `max` 同时存在 ——
 * 于是 min:55 形同虚设，0 一律判违规。
 *
 * 后果比「弹个提示」严重得多：问诊发生在启动链中途且 await 用户作答
 * （ModuleLiveSyncMain → onFirstInitialise → runDoctor → performDoctorConsultation），
 * 不作答就走不到紧随其后的 applySettings()，复制器不会启动 ——
 * 「激活当下能同步，一重启就静默停摆」。真机零插桩实测：弹窗挂满 60 秒纹丝不动。
 *
 * 这里锁两件事：① 写进去的值 == 规章要求值；② **激活后不应再有任何问诊违规**。
 * 第二条比第一条重要 —— 将来上游升版新增要求值时，这组测试会红在 CI，
 * 而不是红在用户重启后的设备上。
 */
describe("buildSetupPatch：不得把设备留在会被配置诊断拦下的状态", () => {
    const payload: Record<string, unknown> = {
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

    it("customChunkSize 必须写成规章要求值（载荷不含它，schema 默认值是 0）", () => {
        expect(buildSetupPatch(payload).customChunkSize).toBe(DoctorRegulation.rules.customChunkSize?.value);
    });

    it("0 确实会被判违规 —— 证明这一行不是可有可无", () => {
        const withZero: Partial<ObsidianLiveSyncSettings> = {
            ...DEFAULT_SETTINGS,
            ...payload,
            customChunkSize: 0,
        };
        expect(Object.keys(checkUnsuitableValues(withZero).rules)).toContain("customChunkSize");
    });

    it("激活后的设置不得再有任何问诊违规（有违规就会在冷启动阻塞 applySettings）", () => {
        const afterActivation: Partial<ObsidianLiveSyncSettings> = {
            ...DEFAULT_SETTINGS,
            // DEFAULT_SETTINGS 里 `handleFilenameCaseSensitive` 是 undefined，而规章要求 false。
            // 设备上这个键由 SettingService.loadSettings() 在启动早期归一化（真机实测落盘为 false），
            // **不归 buildSetupPatch 管**，所以这里显式补上以复现设备上的真实基线 ——
            // 否则测的是「裸默认常量」而不是「设备真实状态」，会凭空多出一条违规。
            handleFilenameCaseSensitive: false,
            ...buildSetupPatch(payload),
        };
        expect(Object.keys(checkUnsuitableValues(afterActivation).rules)).toEqual([]);
    });
});
