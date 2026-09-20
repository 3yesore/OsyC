import { describe, expect, it } from "vitest";

import { buildSetupPatch, sanitizeLivesyncPatch } from "@/osyc/features/AIAgent/livesyncPatch";
import {
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    DoctorRegulation,
    RebuildOptions,
    checkUnsuitableValues,
    performDoctorConsultation,
} from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import {
    TweakValuesDefault,
    TweakValuesShouldMatchedTemplate,
} from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import { extractObject, isObjectDifferent } from "@vrtmrz/livesync-commonlib/compat/common/utils";

/**
 * 激活流程写下去的同步配置必须让复制器真正启动，且不得制造跨设备分歧。
 *
 * 本文件锁的是 2.0.13（da64efe）与 WIP 88fe5e9 归一后的行为。
 * 归一决策与取舍见 docs/LIVESYNCPATCH-RECONCILIATION.zh.md。
 */

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

function doctorEnvWithRecorder(calls: string[]): Parameters<typeof performDoctorConsultation>[0] {
    return {
        translate: (key: string) => key,
        confirm: {
            askSelectStringDialogue: async (text: string) => {
                calls.push(text);
                return "";
            },
            askYesNoDialog: async () => {
                calls.push("askYesNoDialog");
                return "no";
            },
        },
    } as unknown as Parameters<typeof performDoctorConsultation>[0];
}

describe("buildSetupPatch：激活下发的同步配置", () => {
    it("必须打开同步总开关 liveSync（否则复制器永不启动）", () => {
        expect(buildSetupPatch(SETUP_PAYLOAD).liveSync).toBe(true);
    });

    it("必须标记 isConfigured", () => {
        expect(buildSetupPatch(SETUP_PAYLOAD).isConfigured).toBe(true);
    });

    it("必须把 remoteType 钉成 CouchDB（遗留的 minio/p2p 会让复制器走错远端）", () => {
        expect(buildSetupPatch(SETUP_PAYLOAD).remoteType).toBe("");
        expect(buildSetupPatch({ ...SETUP_PAYLOAD, remoteType: "minio" }).remoteType).toBe("");
    });

    it("载荷里的身份类字段原样保留", () => {
        const patch = buildSetupPatch(SETUP_PAYLOAD);
        expect(patch.couchDB_URI).toBe("https://sync.example.com");
        expect(patch.couchDB_USER).toBe("osyc_sync_abc");
        expect(patch.couchDB_DBNAME).toBe("t_abc");
        expect(patch.couchDB_PASSWORD).toBe("x".repeat(64));
        expect(patch.usePluginSyncV2).toBe(true);
    });

    it("即使后端将来下发 liveSync=false，激活语义仍是打开同步", () => {
        expect(buildSetupPatch({ ...SETUP_PAYLOAD, liveSync: false }).liveSync).toBe(true);
    });

    it("空载荷也要给出可用的开关（不能让用户落到「配好了但不跑」）", () => {
        const patch = buildSetupPatch({});
        expect(patch.liveSync).toBe(true);
        expect(patch.isConfigured).toBe(true);
    });

    it("不认识的键被丢弃，不污染设置", () => {
        expect("notARealSetting" in buildSetupPatch({ ...SETUP_PAYLOAD, notARealSetting: "boom" })).toBe(false);
    });

    it("null / undefined 不写入（避免清空用户已有配置）", () => {
        expect("couchDB_USER" in buildSetupPatch({ ...SETUP_PAYLOAD, couchDB_USER: null })).toBe(false);
    });
});

describe("buildSetupPatch：启动闸门（Doctor 问诊不得阻塞 applySettings）", () => {
    it("必须预先标记 Doctor 规章版本为已处理", () => {
        const patch = buildSetupPatch(SETUP_PAYLOAD);
        expect(patch.doctorProcessedVersion).toBe(DoctorRegulation.version);
        expect(String(patch.doctorProcessedVersion).length).toBeGreaterThan(0);
    });

    it("必须让复制在窗口隐藏时保持连接（否则首次上云会被截断）", () => {
        expect(buildSetupPatch(SETUP_PAYLOAD).keepReplicationActiveInBackground).toBe(true);
    });

    it("激活补丁让 Doctor 咨询静默早退：即使仍有违规也不弹窗", async () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            ...buildSetupPatch(SETUP_PAYLOAD),
            // 故意留一条真实违规（DoctorRegulation 要求 60，设备实际是 0），
            // 以证明静默来自 doctorProcessedVersion，而不是「恰好没有违规」。
            customChunkSize: 0,
        } as unknown as ObsidianLiveSyncSettings;
        expect(Object.keys(checkUnsuitableValues(settings).rules)).toContain("customChunkSize");

        const calls: string[] = [];
        const result = await performDoctorConsultation(doctorEnvWithRecorder(calls), settings, {
            localRebuild: RebuildOptions.ConfirmIfRequired,
            remoteRebuild: RebuildOptions.ConfirmIfRequired,
            activateReason: "updated",
        });

        // 早退分支：没有任何交互，也就不会阻塞紧随其后的 applySettings。
        expect(calls).toEqual([]);
        expect(result.settings.doctorProcessedVersion).toBe(DoctorRegulation.version);
    });

    it("去掉 doctorProcessedVersion 的同一份设置会弹窗 —— 证明这一行是承重的", async () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            ...buildSetupPatch(SETUP_PAYLOAD),
            doctorProcessedVersion: "",
            customChunkSize: 0,
        } as unknown as ObsidianLiveSyncSettings;

        const calls: string[] = [];
        await performDoctorConsultation(doctorEnvWithRecorder(calls), settings, {
            localRebuild: RebuildOptions.ConfirmIfRequired,
            remoteRebuild: RebuildOptions.ConfirmIfRequired,
            activateReason: "updated",
        });
        expect(calls.length).toBeGreaterThan(0);
    });
});

describe("归一依据：为什么弃用 customChunkSize=60", () => {
    it("customChunkSize 是 must-match 参数：Doctor 要求的 60 与远端基线的 0 冲突", () => {
        const doctorValue = DoctorRegulation.rules.customChunkSize?.value;
        expect(doctorValue).toBe(60);
        expect(TweakValuesShouldMatchedTemplate.customChunkSize).toBe(0);

        // 复刻 ensureRemoteIsCompatible 的判定：preferred 与 current 各取一次
        // TweakValuesShouldMatchedTemplate 子集，再 isObjectDifferent(..., true)。
        const baseline = {
            ...TweakValuesDefault,
            ...TweakValuesShouldMatchedTemplate,
        } as Record<string, unknown>;
        const shouldMatched = (values: Record<string, unknown>) =>
            extractObject<Record<string, unknown>>(
                TweakValuesShouldMatchedTemplate as Partial<Record<string, unknown>>,
                values
            );
        const preferredShouldMatched = shouldMatched(baseline);
        const currentShouldMatched = shouldMatched({ ...baseline, customChunkSize: doctorValue });
        expect(isObjectDifferent(preferredShouldMatched, currentShouldMatched, true)).toBe(true);
    });

    it("归一后的补丁不新增任何 must-match 参数（否则会与远端 PREFERRED 冲突）", () => {
        const patch = buildSetupPatch(SETUP_PAYLOAD);
        const addedMustMatch = Object.keys(patch).filter(
            (key) => !(key in SETUP_PAYLOAD) && key in TweakValuesShouldMatchedTemplate
        );
        expect(addedMustMatch).toEqual([]);
        expect("customChunkSize" in patch).toBe(false);
    });

    it("补丁只含载荷键 + 登记过的开关（新增键必须先在这里登记理由）", () => {
        const allowed = new Set([
            ...Object.keys(SETUP_PAYLOAD),
            "isConfigured",
            "liveSync",
            "remoteType",
            "doctorProcessedVersion",
            "keepReplicationActiveInBackground",
        ]);
        expect(Object.keys(buildSetupPatch(SETUP_PAYLOAD)).filter((key) => !allowed.has(key))).toEqual([]);
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

    it("拒绝 agent 修改启动闸门 / 后台开关（只属于激活流程）", () => {
        const { applied, rejected } = sanitizeLivesyncPatch({
            doctorProcessedVersion: "1.0.0",
            keepReplicationActiveInBackground: true,
        });
        expect(Object.keys(applied)).toEqual([]);
        expect(rejected.map((r) => r.key)).toEqual(
            expect.arrayContaining(["doctorProcessedVersion", "keepReplicationActiveInBackground"])
        );
    });

    it("放行白名单里的行为类字段", () => {
        const { applied, rejected } = sanitizeLivesyncPatch({ batchSave: true });
        expect(applied.batchSave).toBe(true);
        expect(rejected).toHaveLength(0);
    });
});
