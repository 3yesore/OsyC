import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    LIVESYNC_ACTIONS,
    describeLiveSyncError,
    maskEndpoint,
    readConfiguredRemote,
    runLiveSyncAction,
    summarizeSyncDiagnostics,
    visibleLiveSyncActions,
    withBusyButton,
    type LiveSyncActionPort,
} from "./livesyncSyncActions";

const modalSource = readFileSync(
    fileURLToPath(new URL("./AIAgentAccountModal.ts", import.meta.url)),
    "utf8"
);
const confirmModalSource = readFileSync(
    fileURLToPath(new URL("./LiveSyncConfirmModal.ts", import.meta.url)),
    "utf8"
);

function createPort(overrides: Partial<LiveSyncActionPort> = {}): LiveSyncActionPort {
    return {
        acceptRemoteMilestone: vi.fn(async () => {}),
        fetchFromRemote: vi.fn(async () => {}),
        pushToRemote: vi.fn(async () => {}),
        rebuildLocalFromRemote: vi.fn(async () => {}),
        overwriteRemoteWithLocal: vi.fn(async () => {}),
        ...overrides,
    };
}

describe("OsyC 同步区 LiveSync 按钮", () => {
    it("提供五个 LiveSync 动作，顺序由安全到最危险", () => {
        expect(LIVESYNC_ACTIONS.map((action) => action.id)).toEqual([
            "accept-milestone",
            "fetch-remote",
            "push-local",
            "rebuild-local",
            "overwrite-remote",
        ]);
        expect(LIVESYNC_ACTIONS.map((action) => action.label)).toEqual([
            "接受远端里程碑 / 加入远端",
            "从远端拉取",
            "推送本机变更",
            "重建本机（用远端覆盖本机）",
            "覆盖远端（用本机覆盖远端）",
        ]);
        // 两个危险动作必须带确认文案，最危险的还要确认词。
        expect(LIVESYNC_ACTIONS.find((a) => a.id === "rebuild-local")?.risk).toBe("danger");
        expect(LIVESYNC_ACTIONS.find((a) => a.id === "overwrite-remote")?.risk).toBe("critical");
        expect(LIVESYNC_ACTIONS.find((a) => a.id === "overwrite-remote")?.confirmKeyword).toBe("覆盖远端");
    });

    it("账户弹窗从动作清单渲染按钮并接入忙态/确认/诊断", () => {
        expect(modalSource).toContain("renderLiveSyncPanel(contentEl, syncState)");
        expect(modalSource).toContain("visibleLiveSyncActions(view)");
        expect(modalSource).toContain("runLiveSyncAction(action.id, control");
        expect(modalSource).toContain("withBusyButton(btn, action.label, action.runningLabel");
        expect(modalSource).toContain("confirmLiveSyncAction");
        expect(modalSource).toContain("LiveSyncConfirmModal");
    });

    it("最危险动作需要逐字输入确认词后才可点确认", () => {
        expect(confirmModalSource).toContain("confirmKeyword");
        expect(confirmModalSource).toContain("setDisabled(input.value.trim() !== keyword)");
    });
});

describe("LiveSync 诊断摘要", () => {
    it("accepted_nodes 不含本机时给出显著提示", () => {
        const view = summarizeSyncDiagnostics({
            configurationId: "osyc",
            configurationName: "OsyC 同步",
            endpoint: "https://sync.sacu3.cn",
            remoteType: "couchdb",
            protocolVersion: 2,
            localNodeId: "node-local-0001",
            acceptedNodes: ["node-other-9999"],
        });
        expect(view.milestoneAccepted).toBe(false);
        expect(view.acceptedLabel).toBe("未接受");
        expect(view.alert).toContain("远端里程碑尚未接受本机");
        expect(view.alert).toContain("接受远端里程碑");
        expect(view.protocolVersionLabel).toBe("2");
        expect(view.endpointLabel).toBe("https://sync.sacu3.cn");
    });

    it("accepted_nodes 含本机时不告警", () => {
        const view = summarizeSyncDiagnostics({ localNodeId: "n1", acceptedNodes: ["n1"] });
        expect(view.milestoneAccepted).toBe(true);
        expect(view.alert).toBeNull();
        expect(view.acceptedLabel).toBe("已接受");
    });

    it("里程碑不可读时是未知状态，不误报未接受", () => {
        const view = summarizeSyncDiagnostics({ localNodeId: "n1", acceptedNodes: null, error: "读取失败" });
        expect(view.milestoneAccepted).toBeNull();
        expect(view.alert).toBeNull();
        expect(view.hint).toContain("未能读取远端里程碑");
        expect(view.error).toBe("读取失败");
    });

    it("接受按钮只在确认未接受时出现", () => {
        const rejected = visibleLiveSyncActions({ milestoneAccepted: false }).map((a) => a.id);
        expect(rejected).toContain("accept-milestone");
        const accepted = visibleLiveSyncActions({ milestoneAccepted: true }).map((a) => a.id);
        expect(accepted).not.toContain("accept-milestone");
        expect(accepted).toEqual(["fetch-remote", "push-local", "rebuild-local", "overwrite-remote"]);
    });

    it("端点只回显域名，绝不回显凭据", () => {
        expect(maskEndpoint("https://user:secret@sync.example.com/db")).toBe("https://sync.example.com");
        expect(maskEndpoint("https://sync.example.com:6984/db?x=1")).toBe("https://sync.example.com:6984");
        expect(maskEndpoint("not a uri")).toBe("not a uri");
        expect(maskEndpoint("")).toBe("");
    });

    it("活动档案优先于顶层字段，且脱敏", () => {
        const info = readConfiguredRemote({
            activeConfigurationId: "osyc",
            remoteType: "couchdb",
            couchDB_URI: "https://legacy.example.com",
            remoteConfigurations: {
                osyc: {
                    id: "osyc",
                    name: "OsyC 同步",
                    uri: "https://user:pw@primary.example.com/db",
                    isEncrypted: false,
                },
            },
        });
        expect(info.configurationId).toBe("osyc");
        expect(info.configurationName).toBe("OsyC 同步");
        expect(info.endpoint).toBe("https://primary.example.com");
        expect(info.remoteType).toBe("couchdb");
    });
});

describe("LiveSync 动作执行门禁", () => {
    it("危险动作未经确认不得执行", async () => {
        for (const id of ["rebuild-local", "overwrite-remote"] as const) {
            const port = createPort();
            const confirm = vi.fn(async () => false);
            const result = await runLiveSyncAction(id, port, confirm);
            expect(confirm).toHaveBeenCalledTimes(1);
            expect(result.ok).toBe(false);
            expect(result.message).toContain("已取消");
            expect(port.rebuildLocalFromRemote).not.toHaveBeenCalled();
            expect(port.overwriteRemoteWithLocal).not.toHaveBeenCalled();
        }
    });

    it("危险动作经确认后才执行", async () => {
        const port = createPort();
        const confirm = vi.fn(async () => true);
        const result = await runLiveSyncAction("rebuild-local", port, confirm);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(port.rebuildLocalFromRemote).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(true);
    });

    it("安全动作不弹确认", async () => {
        const port = createPort();
        const confirm = vi.fn(async () => false);
        const result = await runLiveSyncAction("fetch-remote", port, confirm);
        expect(confirm).not.toHaveBeenCalled();
        expect(port.fetchFromRemote).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(true);
    });

    it("执行中禁用按钮并显示进行中，完成后恢复", async () => {
        const button = { setDisabled: vi.fn(), setButtonText: vi.fn() };
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pending = withBusyButton(button, "推送本机变更", "正在推送…", () => gate);
        expect(button.setDisabled).toHaveBeenLastCalledWith(true);
        expect(button.setButtonText).toHaveBeenLastCalledWith("正在推送…");
        release();
        await pending;
        expect(button.setDisabled).toHaveBeenLastCalledWith(false);
        expect(button.setButtonText).toHaveBeenLastCalledWith("推送本机变更");
    });

    it("执行抛错时按钮也会恢复", async () => {
        const button = { setDisabled: vi.fn(), setButtonText: vi.fn() };
        await expect(
            withBusyButton(button, "从远端拉取", "正在拉取…", async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
        expect(button.setDisabled).toHaveBeenLastCalledWith(false);
        expect(button.setButtonText).toHaveBeenLastCalledWith("从远端拉取");
    });

    it("失败给出中文原因而不是静默", async () => {
        const port = createPort({
            fetchFromRemote: vi.fn(async () => {
                throw new Error("ECONNREFUSED");
            }),
        });
        const result = await runLiveSyncAction("fetch-remote", port, async () => true);
        expect(result.ok).toBe(false);
        expect(result.message).toContain("从远端拉取失败");
        expect(result.message).toContain("ECONNREFUSED");
    });

    it("非 Error 异常也有可展示的中文原因", () => {
        expect(describeLiveSyncError(undefined)).toContain("未知错误");
        expect(describeLiveSyncError(new Error(""))).not.toBe("");
    });
});
