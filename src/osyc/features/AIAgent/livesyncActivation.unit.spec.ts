import { describe, expect, it } from "vitest";

import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import { RemoteTypes, type BucketSyncSetting, type CouchDBConnection } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    OSYC_COUCHDB_REMOTE_TYPE,
    OSYC_SYNC_USER_PREFIX,
    describeReplicationRepair,
    isOfficialOsycEndpoint,
    planProvisionedReplicationRepair,
    verifyActivatedRemote,
} from "@/osyc/features/AIAgent/livesyncActivation";

/**
 * 激活自愈的边界（2.0.18 放宽后）。
 *
 * 背景见 livesyncActivation.ts：setup_uri 载荷不含 liveSync，默认 false，
 * 复制器永不启动；2.0.13 激活补丁还把 customChunkSize 写成 60（must-match 模板
 * 基线是 0），ensureRemoteIsCompatible 返回 MISMATCHED，复制器**静默中止**，
 * 服务端 _changes 请求数恒为 0。
 *
 * 2.0.17 现场反馈：旧守卫要求「isConfigured + osyc_sync_ 前缀 + 非别的远端」三条
 * 同时成立，真实设备档案形态一多就全部漏判。2.0.18 改为三个来源任一成立即修。
 */
describe("planProvisionedReplicationRepair：守卫与缺陷签名", () => {
    const provisioned = {
        isConfigured: true,
        liveSync: false,
        couchDB_USER: OSYC_SYNC_USER_PREFIX + "37e5e9d0a57b47b794a6d08a74f75979",
        couchDB_DBNAME: "t_37e5e9d0a57b47b794a6d08a74f75979",
    };

    it("已激活但总开关是关的：补开", () => {
        expect(planProvisionedReplicationRepair(provisioned)).toEqual({ liveSync: true });
    });

    it("总开关本来就是开的：不动（零写入）", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, liveSync: true })).toBeNull();
    });

    it("完全不是 OsyC 的远端（未配置 / 无前缀 / 非官方域名）：不动", () => {
        expect(
            planProvisionedReplicationRepair({ isConfigured: false, liveSync: true, couchDB_USER: "myuser" })
        ).toBeNull();
        expect(
            planProvisionedReplicationRepair({ liveSync: true, couchDB_USER: 123 } as never)
        ).toBeNull();
    });

    // ── 2.0.18 守卫放宽：三个来源任一命中即视为 OsyC 远端 ──
    it("守卫放宽①：仅 isConfigured 为真也会纠正", () => {
        expect(
            planProvisionedReplicationRepair({ isConfigured: true, liveSync: true, customChunkSize: 60 })
        ).toEqual({ customChunkSize: 0 });
    });

    it("守卫放宽②：活动档案 uri 指向官方端点域也会纠正（即使没有 isConfigured / 前缀）", () => {
        const uri = couchDbUri({ couchDB_URI: "https://osyc3.sacu3.cn" });
        expect(
            planProvisionedReplicationRepair({
                activeConfigurationId: "legacy-couchdb",
                remoteConfigurations: {
                    "legacy-couchdb": { id: "legacy-couchdb", name: "CouchDB Remote", uri, isEncrypted: false },
                },
                liveSync: true,
                customChunkSize: 60,
            })
        ).toEqual({ customChunkSize: 0, remoteType: OSYC_COUCHDB_REMOTE_TYPE });
    });

    it("守卫放宽③：osyc_sync_ 前缀仍然命中（isConfigured 缺失也修）", () => {
        expect(
            planProvisionedReplicationRepair({
                couchDB_USER: OSYC_SYNC_USER_PREFIX + "abc",
                liveSync: true,
                customChunkSize: 60,
            })
        ).toEqual({ customChunkSize: 0 });
    });

    it("激活流程自己的配置 id 或空字符串：可以修", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, activeConfigurationId: "osyc" })
        ).toEqual({ liveSync: true });
        expect(
            planProvisionedReplicationRepair({ ...provisioned, activeConfigurationId: "" })
        ).toEqual({ liveSync: true });
    });

    it("命中 2.0.13 缺陷签名 customChunkSize===60：改回 0，并与补开总开关合并成一笔", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, customChunkSize: 60 })).toEqual({
            liveSync: true,
            customChunkSize: 0,
        });
    });

    it("总开关已开、但 customChunkSize 仍是 60：只纠正分块参数", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, liveSync: true, customChunkSize: 60 })
        ).toEqual({ customChunkSize: 0 });
    });

    it("customChunkSize 是 0（正常基线）：不动", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, liveSync: true, customChunkSize: 0 })
        ).toBeNull();
        expect(planProvisionedReplicationRepair({ ...provisioned, customChunkSize: 0 })).toEqual({
            liveSync: true,
        });
    });

    it("customChunkSize 是用户自配的其它值：不动（只有精确的缺陷值 60 才纠正）", () => {
        for (const value of [55, 100, 1024, "60", true, null]) {
            expect(
                planProvisionedReplicationRepair({ ...provisioned, liveSync: true, customChunkSize: value })
            ).toBeNull();
        }
    });

    it("OsyC 守卫不得被分块纠正绕过：非 OsyC 配置的 60 也不动", () => {
        expect(
            planProvisionedReplicationRepair({
                isConfigured: false,
                liveSync: true,
                couchDB_USER: "myuser",
                customChunkSize: 60,
            })
        ).toBeNull();
    });

    it("空/畸形输入：安全返回 null", () => {
        expect(planProvisionedReplicationRepair(null)).toBeNull();
        expect(planProvisionedReplicationRepair(undefined)).toBeNull();
        expect(planProvisionedReplicationRepair({} as never)).toBeNull();
    });
});

/**
 * remoteType 补齐：LiveSync 用**空串**表示 CouchDB（RemoteTypes.REMOTE_COUCHDB === ""）。
 * 绝不能写字符串 "couchdb" —— ReplicatorService 判定 replicatorType === "" 才初始化复制器。
 */
describe("planProvisionedReplicationRepair：remoteType 补齐", () => {
    const withCouchDbProfile = (uri: string) => ({
        isConfigured: true,
        liveSync: true,
        activeConfigurationId: "legacy-couchdb",
        remoteConfigurations: {
            "legacy-couchdb": { id: "legacy-couchdb", name: "CouchDB Remote", uri, isEncrypted: false },
        },
    });

    it("CouchDB 的规范值就是空串，不是字符串 couchdb", () => {
        expect(OSYC_COUCHDB_REMOTE_TYPE).toBe(RemoteTypes.REMOTE_COUCHDB);
        expect(OSYC_COUCHDB_REMOTE_TYPE).toBe("");
    });

    it("remoteType 缺失且活动档案可解析为 couchdb：补规范空串", () => {
        expect(
            planProvisionedReplicationRepair({ ...withCouchDbProfile(couchDbUri()), remoteType: undefined })
        ).toEqual({ remoteType: OSYC_COUCHDB_REMOTE_TYPE });
    });

    it("remoteType 为 null 也补", () => {
        expect(
            planProvisionedReplicationRepair({ ...withCouchDbProfile(couchDbUri()), remoteType: null })
        ).toEqual({ remoteType: OSYC_COUCHDB_REMOTE_TYPE });
    });

    it("customChunkSize=60 与 remoteType 缺失合并成一笔窄补丁", () => {
        expect(
            planProvisionedReplicationRepair({
                ...withCouchDbProfile(couchDbUri()),
                remoteType: undefined,
                customChunkSize: 60,
            })
        ).toEqual({ customChunkSize: 0, remoteType: OSYC_COUCHDB_REMOTE_TYPE });
    });

    it("remoteType 已是规范空串 / 已是其它合法远端类型：零写入", () => {
        expect(planProvisionedReplicationRepair({ ...withCouchDbProfile(couchDbUri()), remoteType: "" })).toBeNull();
        expect(
            planProvisionedReplicationRepair({ ...withCouchDbProfile(couchDbUri()), remoteType: "MINIO" })
        ).toBeNull();
    });

    it("活动档案不是 couchdb：不补 remoteType", () => {
        expect(
            planProvisionedReplicationRepair({ ...withCouchDbProfile(s3Uri()), remoteType: undefined })
        ).toBeNull();
    });

    it("幂等：连跑两次只在第一次产出补丁（应用后第二次零写入）", () => {
        let settings: Record<string, unknown> = {
            isConfigured: true,
            liveSync: true,
            remoteType: undefined,
            customChunkSize: 60,
            activeConfigurationId: "legacy-couchdb",
            remoteConfigurations: {
                "legacy-couchdb": { id: "legacy-couchdb", name: "CouchDB Remote", uri: couchDbUri(), isEncrypted: false },
            },
        };
        const writes: Record<string, unknown>[] = [];
        const apply = (patch: Record<string, unknown>) => {
            writes.push(patch);
            settings = { ...settings, ...patch };
        };

        const first = planProvisionedReplicationRepair(settings);
        expect(first).toEqual({ customChunkSize: 0, remoteType: OSYC_COUCHDB_REMOTE_TYPE });
        apply(first as Record<string, unknown>);

        const second = planProvisionedReplicationRepair(settings);
        expect(second).toBeNull();
        expect(writes).toHaveLength(1);
    });

    it("describeReplicationRepair 翻出可读改动清单（不含凭据）", () => {
        expect(
            describeReplicationRepair({ liveSync: true, customChunkSize: 0, remoteType: OSYC_COUCHDB_REMOTE_TYPE })
        ).toEqual(["补开 LiveSync 同步开关", "纠正 customChunkSize 为 0", "补上 remoteType 为 couchdb"]);
        expect(describeReplicationRepair({})).toEqual([]);
    });
});

describe("isOfficialOsycEndpoint", () => {
    it("识别官方域（含端口 / 路径 / 历史子域），不误判自建远端", () => {
        expect(isOfficialOsycEndpoint("https://osyc3.sacu3.cn")).toBe(true);
        expect(isOfficialOsycEndpoint("https://sync.sacu3.cn:6984/db")).toBe(true);
        expect(isOfficialOsycEndpoint("https://api4.sacu3.cn")).toBe(true);
        expect(isOfficialOsycEndpoint(couchDbUri({ couchDB_URI: "https://osyc3.sacu3.cn" }))).toBe(true);
        expect(isOfficialOsycEndpoint("https://sync.example.com")).toBe(false);
        expect(isOfficialOsycEndpoint("https://notsacu3.cn")).toBe(false);
        expect(isOfficialOsycEndpoint("")).toBe(false);
        expect(isOfficialOsycEndpoint(undefined)).toBe(false);
    });
});


/** 用**真实** ConnectionStringParser 造 couchdb 档案 uri（不 mock）。 */
function couchDbUri(overrides: Partial<CouchDBConnection> = {}): string {
    return ConnectionStringParser.serialize({
        type: "couchdb",
        settings: {
            couchDB_URI: "https://sync.example.com",
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
            ...overrides,
        } as unknown as CouchDBConnection,
    });
}

/** 用**真实** ConnectionStringParser 造 s3 档案 uri（不 mock）。 */
function s3Uri(): string {
    return ConnectionStringParser.serialize({
        type: "s3",
        settings: {
            accessKey: "access-key",
            secretKey: "secret-key",
            bucket: "my-bucket",
            region: "auto",
            endpoint: "https://s3.example.com",
            useCustomRequestHandler: false,
            bucketCustomHeaders: "",
            bucketPrefix: "",
            forcePathStyle: true,
        } as unknown as BucketSyncSetting,
    });
}

function activatedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        activeConfigurationId: "legacy-couchdb",
        remoteConfigurations: {
            "legacy-couchdb": {
                id: "legacy-couchdb",
                name: "CouchDB Remote",
                uri: couchDbUri(),
                isEncrypted: false,
            },
        },
        ...overrides,
    };
}

/**
 * 激活回读自检：applySetupUri 写完之后必须回读，确认活动档案仍是可用的 couchdb。
 *
 * 现场（2026-09-20）：插件报告激活成功，但 data.json 里顶层 couchDB_* 全空、
 * remoteConfigurations={}、activeConfigurationId=""，客户端没有任何远端。
 * 这里用真实 parser，证明判定确实基于档案 uri，而不是会被保存时清空的明文顶层字段。
 */
describe("verifyActivatedRemote：激活后回读自检", () => {
    it("活动档案 uri 可解析为 couchdb 且 uri / dbname 非空：自检通过", () => {
        expect(verifyActivatedRemote(activatedSettings())).toEqual({ ok: true });
    });

    it("判定依据是档案 uri，而不是明文顶层字段（顶层会被保存时清空）", () => {
        // 现场形态：顶层 couchDB_* 全空，但活动档案 uri 完整 —— 这是正常保存，不是失败。
        const profileOnly = activatedSettings({
            couchDB_URI: "",
            couchDB_USER: "",
            couchDB_PASSWORD: "",
            couchDB_DBNAME: "",
        });
        expect(verifyActivatedRemote(profileOnly)).toEqual({ ok: true });

        // 反向：顶层字段看着齐全，但活动档案缺失 —— 下次启动会被覆盖回空/旧端点，必须失败。
        const onlyPlaintext = {
            couchDB_URI: "https://sync.example.com",
            couchDB_USER: "osyc_sync_testuser",
            couchDB_PASSWORD: "secret-pass",
            couchDB_DBNAME: "t_testdb",
            activeConfigurationId: "",
            remoteConfigurations: {},
        };
        expect(verifyActivatedRemote(onlyPlaintext).ok).toBe(false);
    });

    it("自检失败不抛异常，返回 ok=false 且给出中文原因", () => {
        const cases: unknown[] = [
            { activeConfigurationId: "", remoteConfigurations: { "legacy-couchdb": { uri: couchDbUri() } } },
            { activeConfigurationId: "legacy-couchdb", remoteConfigurations: {} },
            { activeConfigurationId: "legacy-couchdb" },
            activatedSettings({ activeConfigurationId: "missing" }),
            activatedSettings({ remoteConfigurations: {} }),
            activatedSettings({
                remoteConfigurations: { "legacy-couchdb": { id: "legacy-couchdb", uri: "" } },
            }),
            activatedSettings({
                remoteConfigurations: { "legacy-couchdb": { id: "legacy-couchdb", uri: "not-a-connection-string" } },
            }),
            null,
            undefined,
            "not-an-object",
            42,
        ];
        for (const settings of cases) {
            let result: ReturnType<typeof verifyActivatedRemote> | undefined;
            expect(() => {
                result = verifyActivatedRemote(settings);
            }).not.toThrow();
            expect(result!.ok).toBe(false);
            expect(typeof result!.reason).toBe("string");
            expect(result!.reason!.length).toBeGreaterThan(0);
        }
    });

    it("活动档案不是 couchdb（例如 S3）：失败并说明实际类型", () => {
        const s3Uri = ConnectionStringParser.serialize({
            type: "s3",
            settings: {
                accessKey: "access-key",
                secretKey: "secret-key",
                bucket: "my-bucket",
                region: "auto",
                endpoint: "https://s3.example.com",
                useCustomRequestHandler: false,
                bucketCustomHeaders: "",
                bucketPrefix: "",
                forcePathStyle: true,
            } as unknown as BucketSyncSetting,
        });
        const result = verifyActivatedRemote(
            activatedSettings({
                remoteConfigurations: { "legacy-couchdb": { id: "legacy-couchdb", uri: s3Uri } },
            })
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("couchdb");
    });

    it("档案 uri 解析出的 couchDB_DBNAME 为空：失败（真实 parser 造样本）", () => {
        const result = verifyActivatedRemote(
            activatedSettings({
                remoteConfigurations: {
                    "legacy-couchdb": { id: "legacy-couchdb", uri: couchDbUri({ couchDB_DBNAME: "" }) },
                },
            })
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("couchDB_DBNAME");
    });
});
