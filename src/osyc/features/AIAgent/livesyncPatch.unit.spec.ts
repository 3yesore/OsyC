import { describe, expect, it } from "vitest";
import { buildSetupPatch, sanitizeLivesyncPatch } from "./livesyncPatch";

/**
 * 这些测试锁住的是安全边界，不是实现细节。
 *
 * 最要紧的两条：
 *   1. 身份类键（远端地址/凭据）永远不可能被自动写入 —— 写错用户就丢数据源
 *   2. 激活流程不得把用户的其他偏好重置成默认值
 */
describe("sanitizeLivesyncPatch", () => {
    it("拒绝身份类键：改错会丢数据源", () => {
        const r = sanitizeLivesyncPatch({
            couchDB_URI: "https://evil.example.com",
            bucket: "attacker-bucket",
            accessKey: "AKIAxxxx",
        });
        expect(r.applied).toEqual({});
        expect(r.rejected.map((x) => x.key)).toEqual(
            expect.arrayContaining(["couchDB_URI", "bucket", "accessKey"])
        );
        expect(r.rejected[0].reason).toContain("数据源身份");
    });

    it("拒绝白名单外的键：默认拒绝，新加的设置不会被自动改到", () => {
        const r = sanitizeLivesyncPatch({ someFutureSetting: true, displayLanguage: "zh" });
        expect(r.applied).toEqual({});
        expect(r.rejected.every((x) => x.reason.includes("不在允许调整的范围内"))).toBe(true);
    });

    it("允许白名单内的行为类键", () => {
        const r = sanitizeLivesyncPatch({ batchSave: true, suspendFileWatching: false });
        expect(r.applied).toEqual({ batchSave: true, suspendFileWatching: false });
        expect(r.rejected).toEqual([]);
    });

    it("拒绝类型不合法的值：模型常把布尔写成字符串", () => {
        const r = sanitizeLivesyncPatch({ batchSave: "true" as unknown as boolean });
        expect(r.applied).toEqual({});
        expect(r.rejected[0].reason).toContain("类型不合法");
    });

    it("拒绝 null：写 null 等于清空配置", () => {
        const r = sanitizeLivesyncPatch({
            batchSave: null as unknown as boolean,
            useIndexedDBAdapter: undefined as unknown as boolean,
        });
        expect(r.applied).toEqual({});
        expect(r.rejected).toHaveLength(2);
    });

    it("身份类的优先级高于白名单：即使值合法也不放行", () => {
        // 防御性测试：万一以后有人把身份类键误加进白名单，这里会失败
        const r = sanitizeLivesyncPatch({ couchDB_URI: "https://x", batchSave: true });
        expect(r.applied).toEqual({ batchSave: true });
        expect(Object.keys(r.applied)).not.toContain("couchDB_URI");
    });

    it("空补丁不报错", () => {
        const r = sanitizeLivesyncPatch({});
        expect(r.applied).toEqual({});
        expect(r.rejected).toEqual([]);
    });
});

describe("buildSetupPatch", () => {
    it("激活流程可以写身份类键 —— 同步目标本来就来自后端下发", () => {
        const patch = buildSetupPatch({
            couchDB_URI: "https://sync.example.com",
            couchDB_DBNAME: "osyc-tenant",
        });
        expect(patch.couchDB_URI).toBe("https://sync.example.com");
        expect(patch.couchDB_DBNAME).toBe("osyc-tenant");
    });

    it("总是标记 isConfigured", () => {
        const patch = buildSetupPatch({ batchSave: true });
        expect(patch.isConfigured).toBe(true);
    });

    it("不做 DEFAULT_SETTINGS 打底：不夹带任何用户没指定的键", () => {
        // 这是原先实现的坑：整份替换会把用户其他偏好重置成默认值。
        // 这里断言补丁里只有显式传入的键 + isConfigured。
        const patch = buildSetupPatch({ couchDB_URI: "https://sync.example.com" });
        expect(Object.keys(patch).sort()).toEqual(["couchDB_URI", "isConfigured"]);
    });

    it("过滤掉后端下发的畸形值", () => {
        const patch = buildSetupPatch({
            couchDB_URI: "https://ok.example.com",
            batchSave: "not-a-boolean" as unknown as boolean,
        });
        expect(patch.couchDB_URI).toBe("https://ok.example.com");
        expect(patch).not.toHaveProperty("batchSave");
    });

    it("忽略 null / undefined，不把空值写进设置", () => {
        const patch = buildSetupPatch({
            couchDB_URI: "https://ok.example.com",
            couchDB_USER: null as unknown as string,
        });
        expect(patch).not.toHaveProperty("couchDB_USER");
        expect(patch.couchDB_URI).toBe("https://ok.example.com");
    });
});
