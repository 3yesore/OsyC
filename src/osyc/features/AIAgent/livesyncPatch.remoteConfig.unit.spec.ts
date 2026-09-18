import { describe, expect, it } from "vitest";

import { ConnectionStringParser } from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import type {
    BucketSyncSetting,
    CouchDBConnection,
    P2PConnectionInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { RemoteConfiguration } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import { planCouchDbRemoteConfigurationReroute } from "@/osyc/features/AIAgent/livesyncPatch";

/**
 * 激活时不仅要写顶层 couchDB_*，还要把活动远程配置档案的 uri 一起改到新目标。
 *
 * 根因：LiveSync 2.x 的 SettingService.loadSettings() 在 activeConfigurationId
 * 指向的档案存在时，会用档案 uri 调用 activateRemoteConfiguration() 覆盖顶层字段；
 * 而 applyPartial / applyExternalSettings 都不会碰 remoteConfigurations。
 * 不重写档案的激活，下次启动就会被旧端点覆盖回去。
 *
 * 这里用**真实**的 ConnectionStringParser，不 mock —— 只有真实序列化/解析才能
 * 证明改完的档案确实指向新后端。
 */

const TARGET = {
    couchDB_URI: "https://new.sync.example.com",
    couchDB_USER: "osyc_sync_newuser",
    couchDB_PASSWORD: "newpass-secret",
    couchDB_DBNAME: "t_newdb",
} as const;

function serializeCouchDb(target: Record<string, unknown>): string {
    return ConnectionStringParser.serialize({
        type: "couchdb",
        settings: target as unknown as CouchDBConnection,
    });
}

function serializeS3(): string {
    return ConnectionStringParser.serialize({
        type: "s3",
        settings: {
            endpoint: "https://s3.example.com",
            accessKey: "access-key",
            secretKey: "secret-key",
            bucket: "my-bucket",
            region: "auto",
            bucketPrefix: "",
            useCustomRequestHandler: false,
            bucketCustomHeaders: "",
            forcePathStyle: true,
        } as unknown as BucketSyncSetting,
    });
}

function serializeP2P(): string {
    return ConnectionStringParser.serialize({
        type: "p2p",
        settings: {
            P2P_Enabled: true,
            P2P_roomID: "my-room",
            P2P_passphrase: "room-pass",
            P2P_relays: "wss://relay.example.com",
            P2P_AppID: "self-hosted-livesync",
            P2P_AutoStart: false,
            P2P_AutoBroadcast: false,
            P2P_turnServers: "",
            P2P_turnUsername: "",
            P2P_turnCredential: "",
            P2P_maxWirePayloadBytes: 0,
            P2P_connectionPath: "",
        } as unknown as P2PConnectionInfo,
    });
}

const OLD_COUCHDB_URI = serializeCouchDb({
    couchDB_URI: "https://sync.sacu3.cn",
    couchDB_USER: "olduser",
    couchDB_PASSWORD: "oldpass",
    couchDB_DBNAME: "olddb",
});

function couchDbConfiguration(id: string, uri: string, overrides: Partial<RemoteConfiguration> = {}): RemoteConfiguration {
    return { id, name: `CouchDB ${id}`, uri, isEncrypted: false, ...overrides };
}

describe("planCouchDbRemoteConfigurationReroute：激活时改写远程配置档案", () => {
    it("有 couchdb 档案时改写 uri、置 isEncrypted=false，并保持原 activeConfigurationId", () => {
        const existing = { "legacy-couchdb": couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI) };
        const result = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: existing,
            activeConfigurationId: "legacy-couchdb",
        });

        expect(result.changed).toBe(true);
        expect(result.activeConfigurationId).toBe("legacy-couchdb");

        const updated = result.remoteConfigurations["legacy-couchdb"];
        expect(updated.uri).not.toBe(OLD_COUCHDB_URI);
        expect(updated.isEncrypted).toBe(false);
        // 档案的展示名 / id 不应被顺手改掉
        expect(updated.id).toBe("legacy-couchdb");
        expect(updated.name).toBe("CouchDB legacy-couchdb");

        // 用真实 parse 解回来，证明确实指向新后端
        const parsed = ConnectionStringParser.parse(updated.uri);
        if (parsed.type !== "couchdb") throw new Error(`expected couchdb, got ${parsed.type}`);
        expect(parsed.settings.couchDB_URI).toBe(TARGET.couchDB_URI);
        expect(parsed.settings.couchDB_USER).toBe(TARGET.couchDB_USER);
        expect(parsed.settings.couchDB_PASSWORD).toBe(TARGET.couchDB_PASSWORD);
        expect(parsed.settings.couchDB_DBNAME).toBe(TARGET.couchDB_DBNAME);
    });

    it("S3 / P2P 档案原样保留，绝不因为激活而丢用户配置", () => {
        const s3Uri = serializeS3();
        const p2pUri = serializeP2P();
        const s3 = { id: "legacy-s3", name: "S3 Remote", uri: s3Uri, isEncrypted: false } as RemoteConfiguration;
        const p2p = { id: "legacy-p2p", name: "P2P Remote", uri: p2pUri, isEncrypted: false } as RemoteConfiguration;

        const result = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: {
                "legacy-couchdb": couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI),
                "legacy-s3": s3,
                "legacy-p2p": p2p,
            },
            activeConfigurationId: "legacy-couchdb",
        });

        // 引用级保留：S3 / P2P 完全没被碰
        expect(result.remoteConfigurations["legacy-s3"]).toBe(s3);
        expect(result.remoteConfigurations["legacy-p2p"]).toBe(p2p);
        expect(ConnectionStringParser.parse(result.remoteConfigurations["legacy-s3"].uri).type).toBe("s3");
        expect(ConnectionStringParser.parse(result.remoteConfigurations["legacy-p2p"].uri).type).toBe("p2p");
        // couchdb 档案仍然被改写
        expect(result.remoteConfigurations["legacy-couchdb"].uri).not.toBe(OLD_COUCHDB_URI);
    });

    it("没有任何 couchdb 档案时把 activeConfigurationId 置空（交给下次启动重建）", () => {
        const result = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: {},
            activeConfigurationId: "legacy-couchdb",
        });

        expect(result.remoteConfigurations).toEqual({});
        expect(result.activeConfigurationId).toBe("");
        expect(result.changed).toBe(true);
    });

    it("只有非 couchdb 档案时也置空 active，但仍保留这些档案", () => {
        const s3 = { id: "legacy-s3", name: "S3 Remote", uri: serializeS3(), isEncrypted: false } as RemoteConfiguration;
        const result = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: { "legacy-s3": s3 },
            activeConfigurationId: "legacy-s3",
        });

        expect(result.remoteConfigurations["legacy-s3"]).toBe(s3);
        expect(result.activeConfigurationId).toBe("");
        expect(result.changed).toBe(true);
    });

    it("原 active 指向非 couchdb 档案时改选第一个 couchdb 档案", () => {
        const s3 = { id: "legacy-s3", name: "S3 Remote", uri: serializeS3(), isEncrypted: false } as RemoteConfiguration;
        const couch = couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI);
        const result = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: { "legacy-s3": s3, "legacy-couchdb": couch },
            activeConfigurationId: "legacy-s3",
        });

        expect(result.activeConfigurationId).toBe("legacy-couchdb");
        expect(result.changed).toBe(true);
    });

    it("decoded 缺字段（含空字符串）时完全不动，changed=false", () => {
        const existing = { "legacy-couchdb": couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI) };

        for (const decoded of [
            { couchDB_URI: TARGET.couchDB_URI, couchDB_USER: TARGET.couchDB_USER, couchDB_DBNAME: TARGET.couchDB_DBNAME },
            { ...TARGET, couchDB_PASSWORD: "" },
            { ...TARGET, couchDB_URI: "   " },
            {},
        ]) {
            const result = planCouchDbRemoteConfigurationReroute(decoded, {
                remoteConfigurations: existing,
                activeConfigurationId: "legacy-couchdb",
            });
            expect(result.changed).toBe(false);
            // 原样返回：连引用都不换
            expect(result.remoteConfigurations).toBe(existing);
            expect(result.activeConfigurationId).toBe("legacy-couchdb");
        }
    });

    it("幂等：目标 uri 已经相同就不再标记 changed", () => {
        const first = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: { "legacy-couchdb": couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI) },
            activeConfigurationId: "legacy-couchdb",
        });
        expect(first.changed).toBe(true);

        const second = planCouchDbRemoteConfigurationReroute(TARGET, {
            remoteConfigurations: first.remoteConfigurations,
            activeConfigurationId: first.activeConfigurationId,
        });
        expect(second.changed).toBe(false);
        expect(second.remoteConfigurations["legacy-couchdb"].uri).toBe(
            first.remoteConfigurations["legacy-couchdb"].uri
        );
    });

    it("坏 uri 不抛异常：坏档案原样保留，好档案照常改写", () => {
        const broken: RemoteConfiguration = {
            id: "broken",
            name: "Broken Remote",
            uri: "this-is-not-a-connection-string",
            isEncrypted: false,
        };
        const good = couchDbConfiguration("legacy-couchdb", OLD_COUCHDB_URI);

        let result: ReturnType<typeof planCouchDbRemoteConfigurationReroute> | undefined;
        expect(() => {
            result = planCouchDbRemoteConfigurationReroute(TARGET, {
                remoteConfigurations: { broken, "legacy-couchdb": good },
                activeConfigurationId: "legacy-couchdb",
            });
        }).not.toThrow();

        expect(result!.remoteConfigurations.broken).toBe(broken);
        expect(result!.remoteConfigurations["legacy-couchdb"].uri).not.toBe(OLD_COUCHDB_URI);
        expect(result!.changed).toBe(true);
    });

    it("没有档案时返回空对象且 active 置空", () => {
        const result = planCouchDbRemoteConfigurationReroute(TARGET, {});
        expect(result.remoteConfigurations).toEqual({});
        expect(result.activeConfigurationId).toBe("");
        // active 本来就是空，无实际变化
        expect(result.changed).toBe(false);
    });
});
