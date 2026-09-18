import { describe, expect, it } from "vitest";

import {
    OSYC_SYNC_USER_PREFIX,
    planProvisionedReplicationRepair,
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
