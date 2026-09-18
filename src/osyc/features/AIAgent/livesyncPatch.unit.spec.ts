import { describe, expect, it } from "vitest";

import { buildSetupPatch, sanitizeLivesyncPatch } from "@/osyc/features/AIAgent/livesyncPatch";

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
