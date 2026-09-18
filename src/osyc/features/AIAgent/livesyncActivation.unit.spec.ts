import { describe, expect, it } from "vitest";

import {
    OSYC_REMOTE_CONFIG_ID,
    planProvisionedReplicationRepair,
} from "@/osyc/features/AIAgent/livesyncActivation";

/**
 * 激活自愈的边界：只救「被激活流程配置过、且没有别的远端」的安装。
 *
 * 背景见 livesyncActivation.ts：setup_uri 载荷不含 liveSync，默认 false，
 * 复制器永不启动，vault 一条都传不上云。
 */
describe("planProvisionedReplicationRepair", () => {
    const provisioned = {
        isConfigured: true,
        liveSync: false,
        activeConfigurationId: OSYC_REMOTE_CONFIG_ID,
        remoteConfigurations: { [OSYC_REMOTE_CONFIG_ID]: { id: OSYC_REMOTE_CONFIG_ID, name: "OsyC" } },
    };

    it("已激活但总开关是关的：补开", () => {
        expect(planProvisionedReplicationRepair(provisioned)).toEqual({ liveSync: true });
    });

    it("总开关本来就是开的：不动", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, liveSync: true })).toBeNull();
    });

    it("没有 osyc 远端配置：不动（不是我们配的安装）", () => {
        expect(
            planProvisionedReplicationRepair({ ...provisioned, remoteConfigurations: { mine: { id: "mine" } } })
        ).toBeNull();
    });

    it("用户还有别的远端配置且没指定激活项：不动", () => {
        expect(
            planProvisionedReplicationRepair({
                ...provisioned,
                activeConfigurationId: "",
                remoteConfigurations: { [OSYC_REMOTE_CONFIG_ID]: {}, mine: { id: "mine" } },
            })
        ).toBeNull();
    });

    it("当前正使用别的远端：不动", () => {
        expect(
            planProvisionedReplicationRepair({
                ...provisioned,
                activeConfigurationId: "mine",
                remoteConfigurations: { [OSYC_REMOTE_CONFIG_ID]: {}, mine: { id: "mine" } },
            })
        ).toBeNull();
    });

    it("还没完成配置：不动", () => {
        expect(planProvisionedReplicationRepair({ ...provisioned, isConfigured: false })).toBeNull();
    });

    it("空/畸形输入：安全返回 null", () => {
        expect(planProvisionedReplicationRepair(null)).toBeNull();
        expect(planProvisionedReplicationRepair(undefined)).toBeNull();
        expect(planProvisionedReplicationRepair({} as never)).toBeNull();
        expect(planProvisionedReplicationRepair({ ...provisioned, remoteConfigurations: [] })).toBeNull();
    });
});
