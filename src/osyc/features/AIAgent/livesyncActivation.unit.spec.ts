import { describe, expect, it } from "vitest";

import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import type { BucketSyncSetting, CouchDBConnection } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    OSYC_SYNC_USER_PREFIX,
    planProvisionedReplicationRepair,
    verifyActivatedRemote,
} from "@/osyc/features/AIAgent/livesyncActivation";

/**
 * 激活自愈的边界：只救「由激活流程配置、且没有切到别的远端」的安装。
 *
 * 背景见 livesyncActivation.ts：setup_uri 载荷不含 liveSync，默认 false，
 * 复制器永不启动，vault 一条都传不上云。
 */
describe("planProvisionedReplicationRepair", () => {
    const provisioned = {
        isConfigured: true,
        liveSync: false,
        couchDB_USER: OSYC_SYNC_USER_PREFIX + "37e5e9d0a57b47b794a6d08a74f75979",
        couchDB_DBNAME: "t_37e5e9d0a57b47b794a6d08a74f75979",
    };

    it("已激活但总开关是关的：补开", () => {
        expect(planProvisionedReplicationRepair(provisioned)).toEqual({ liveSync: true });
    });

    it("总开关本来就是开的：不动", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, liveSync: true })).toBeNull();
    });

    it("不是 OsyC 建的同步账号（用户自己配的）：不动", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, couchDB_USER: "myuser" })).toBeNull();
        expect(planProvisionedReplicationRepair({ ...provisioned, couchDB_USER: undefined })).toBeNull();
    });

    it("当前正使用别的远端配置：不动", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, activeConfigurationId: "mine" })
        ).toBeNull();
    });

    it("激活流程自己的配置 id 或空字符串：可以修", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, activeConfigurationId: "osyc" })
        ).toEqual({ liveSync: true });
        expect(
            planProvisionedReplicationRepair({ ...provisioned, activeConfigurationId: "" })
        ).toEqual({ liveSync: true });
    });

    it("还没完成配置：不动", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, isConfigured: false })).toBeNull();
    });

    it("空/畸形输入：安全返回 null", () => {
        expect(planProvisionedReplicationRepair(null)).toBeNull();
        expect(planProvisionedReplicationRepair(undefined)).toBeNull();
        expect(planProvisionedReplicationRepair({} as never)).toBeNull();
        expect(planProvisionedReplicationRepair({ ...provisioned, couchDB_USER: 123 } as never)).toBeNull();
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
