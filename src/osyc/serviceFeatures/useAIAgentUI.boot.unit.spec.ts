import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B2（2.0.16 上架阻断）行为级回归：全新安装没有 livesync-aiagent.json 时，
 * onInitialise 必须把 agent.settings.apiBase 落到官方默认地址，且随后第一次
 * 点击激活要**真的发出** /api/activate 请求。
 *
 * 这里把 Obsidian / LiveSync / 主题渲染等外围依赖全部替换成最小替身，只保留
 * useAIAgentUI 的真实初始化路径与真实的 CmdAIAgent。
 */

const requestUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/deps.ts", () => {
    class Modal {}
    class Notice {}
    class Setting {}
    class TFile {}
    return {
        Modal,
        Notice,
        Setting,
        TFile,
        Platform: { isAndroidApp: false, isIosApp: false },
        requestUrl: (...args: unknown[]) => requestUrlMock(...args),
    };
});

vi.mock("@/osyc/features/AIAgent/AIAgentPaneView", () => ({
    AIAgentPaneView: class {},
    VIEW_TYPE_AI_AGENT: "osyc-ai-agent",
}));

vi.mock("@/osyc/features/AIAgent/AIAgentFloating", () => ({
    AIAgentFloating: class {
        mount() {}
        toggle() {}
        handleTripleTap() {}
        setTripleTap() {}
        setShowBall() {}
        setPosition() {}
        destroy() {}
    },
}));

vi.mock("@/osyc/features/AIAgent/AIAgentAccountModal", () => ({
    AIAgentAccountModal: class { open() {} close() {} },
}));

vi.mock("@/osyc/features/AIAgent/AIAgentToolsModal", () => ({
    AIAgentToolsModal: class { open() {} close() {} },
}));

vi.mock("@/osyc/features/AIAgent/AnnouncementModal", () => ({
    AnnouncementModal: class { open() {} close() {} },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/API/processSetting", () => ({
    decodeSettingsFromSetupURI: vi.fn(),
}));

vi.mock("@/osyc/features/AIAgent/livesyncPatch", () => ({
    buildSetupPatch: vi.fn(() => ({})),
    planCouchDbRemoteConfigurationReroute: vi.fn(() => ({ changed: false })),
    sanitizeLivesyncPatch: vi.fn(() => ({ applied: {}, rejected: [] })),
}));

vi.mock("@/osyc/features/AIAgent/livesyncActivation", () => ({
    // 返回 null 让加载期自愈直接跳过，避免引入 LiveSync 复制器依赖。
    planProvisionedReplicationRepair: vi.fn(() => null),
    describeReplicationRepair: vi.fn(() => []),
    verifyActivatedRemote: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/osyc/features/AIAgent/livesyncSyncActions", () => ({
    describeLiveSyncError: (error: unknown) => String(error),
    readConfiguredRemote: () => ({}),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));

vi.mock("@/osyc/theme/themeModel", () => ({
    applyThemeProfileStyles: vi.fn(),
    migrateAppearanceToThemeProfile: vi.fn((value: unknown) => value),
}));

vi.mock("@/osyc/theme/themeScope", () => ({
    syncMarkdownThemeScope: vi.fn(),
}));

vi.mock("@/osyc/theme/themePack", () => ({
    applyThemePackScope: vi.fn(() => () => {}),
    themePackForId: vi.fn(() => null),
}));

vi.mock("@/osyc/features/AIAgent/diagnosticsUpload", () => ({
    uploadErrorReport: vi.fn(),
}));

import { useAIAgentUI } from "./useAIAgentUI";
import { DEFAULT_SERVICE_URL } from "@/osyc/features/AIAgent/serviceDefaults";

interface InitialiseHandler {
    (): Promise<boolean>;
}

beforeAll(() => {
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = {
        setTimeout: (...args: unknown[]) => (globalThis.setTimeout as unknown as (...a: unknown[]) => unknown)(...args),
        clearTimeout: (...args: unknown[]) => (globalThis.clearTimeout as unknown as (...a: unknown[]) => unknown)(...args),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        confirm: vi.fn(() => false),
        crypto: (globalThis as unknown as { crypto?: unknown }).crypto,
    };
    globals.localStorage = new Map<string, string>();
    globals.document = { body: { classList: { contains: () => false } } };
    // useAIAgentUI 只在 MutationObserver 存在时才 observe DOM；Node 下显式置空。
    globals.MutationObserver = undefined;
});

describe("B2 · 全新安装首启（无 livesync-aiagent.json）", () => {
    const initialiseHandlers: InitialiseHandler[] = [];
    const unloadHandlers: (() => Promise<boolean>)[] = [];

    const adapter = {
        exists: vi.fn(async () => false),
        read: vi.fn(async () => ""),
        write: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        mkdir: vi.fn(async () => {}),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
        writeBinary: vi.fn(async () => {}),
        getResourcePath: vi.fn(() => ""),
    };

    const app = {
        vault: {
            configDir: ".obsidian",
            adapter,
            getAbstractFileByPath: vi.fn(() => null),
            getResourcePath: vi.fn(() => ""),
            getFiles: vi.fn(() => []),
        },
        workspace: {
            on: vi.fn(),
            off: vi.fn(),
            openLinkText: vi.fn(),
            containerEl: { addEventListener: vi.fn() },
        },
    };

    const core = {
        services: {
            context: { app },
            setting: {
                currentSettings: vi.fn(() => ({})),
                applyPartial: vi.fn(async () => {}),
            },
            control: { applySettings: vi.fn(async () => {}) },
            replicator: {
                getActiveReplicator: vi.fn(() => null),
                runBoundedRemoteActivity: vi.fn(),
                runFiniteReplicationActivity: vi.fn(),
            },
            replication: { replicate: vi.fn(async () => {}) },
        },
        rebuilder: { $performRebuildDB: vi.fn(async () => {}) },
    };

    const host = {
        services: {
            API: {
                showWindow: vi.fn(async () => {}),
                registerWindow: vi.fn(),
                addCommand: vi.fn(),
                addRibbonIcon: vi.fn(() => undefined),
            },
            appLifecycle: {
                onInitialise: {
                    addHandler: vi.fn((handler: InitialiseHandler) => {
                        initialiseHandlers.push(handler);
                    }),
                },
                onUnload: {
                    addHandler: vi.fn((handler: () => Promise<boolean>) => {
                        unloadHandlers.push(handler);
                    }),
                },
            },
        },
    };

    beforeEach(() => {
        requestUrlMock.mockReset();
        initialiseHandlers.length = 0;
        unloadHandlers.length = 0;
        adapter.exists.mockReset();
        adapter.exists.mockResolvedValue(false);
    });

    it("首启后 apiBase = DEFAULT_SERVICE_URL，且第一次 activate 真的发出 /api/activate 请求", async () => {
        const agent = useAIAgentUI(host as never, core as never);
        expect(initialiseHandlers).toHaveLength(1);

        await initialiseHandlers[0]();

        // 关键断言 1：没有配置文件时也要有可用地址，否则 activate 被 configurationError 拦下。
        expect(agent.settings.apiBase).toBe(DEFAULT_SERVICE_URL);

        // 关键断言 2：点激活会真的发请求（而不是返回「尚未配置服务地址」）。
        requestUrlMock.mockResolvedValue({ status: 200, json: { token: "issued-token" } });
        const result = await agent.activate("card-key");

        expect(result.ok).toBe(true);
        expect(agent.settings.token).toBe("issued-token");
        expect(requestUrlMock).toHaveBeenCalled();
        expect(String(requestUrlMock.mock.calls[0][0].url)).toBe(`${DEFAULT_SERVICE_URL}/api/activate`);

        // 清掉防抖写盘定时器，避免跨用例残留。
        for (const handler of unloadHandlers) await handler();
    });
});
