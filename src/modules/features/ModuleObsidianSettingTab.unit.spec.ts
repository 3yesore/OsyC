import { beforeEach, describe, expect, it, vi } from "vitest";

const settingTabState = vi.hoisted(() => ({
    callOrder: [] as string[],
    reloadAllSettings: vi.fn<(skipUpdate?: boolean) => void>(),
}));

const eventHubState = vi.hoisted(() => ({
    onEvent: vi.fn(),
}));

const osycSettingsState = vi.hoisted(() => ({
    openOsycSettings: vi.fn(),
}));

vi.mock("./SettingDialogue/ObsidianLiveSyncSettingTab.ts", () => ({
    ObsidianLiveSyncSettingTab: class ObsidianLiveSyncSettingTab {
        reloadAllSettings(skipUpdate?: boolean) {
            settingTabState.callOrder.push(`reload:${String(skipUpdate)}`);
            settingTabState.reloadAllSettings(skipUpdate);
        }
    },
}));

vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_SETTINGS: "request-open-settings",
    eventHub: eventHubState,
}));

// 设置弹窗是值导入，会经 `@/deps.ts` 拿到 obsidian 运行时；单测配置把 `obsidian`
// 别名成空串（见 vitest.config.unit.ts），所以这里必须一并 mock，否则整份 spec
// 会在解析阶段以 "specifiers must be a non-empty string" 失败。
vi.mock("@/osyc/features/AIAgent/OsycSettingsModal", () => ({
    openOsycSettings: osycSettingsState.openOsycSettings,
}));

import { ModuleObsidianSettingDialogue } from "./ModuleObsidianSettingTab.ts";

function createModuleHarness() {
    let initialisationHandler: (() => Promise<boolean>) | undefined;
    let settingsLoadedHandler: (() => Promise<boolean>) | undefined;
    const plugin = {
        app: {},
        addSettingTab: vi.fn(() => settingTabState.callOrder.push("add-setting-tab")),
    };
    const services = {
        appLifecycle: {
            onInitialise: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    initialisationHandler = handler;
                }),
            },
            onSettingLoaded: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => {
                    settingsLoadedHandler = handler;
                }),
            },
        },
    };
    const module = Object.assign(Object.create(ModuleObsidianSettingDialogue.prototype), {
        plugin,
        core: { services },
    }) as ModuleObsidianSettingDialogue;

    module.onBindFunction(module.core as never, services as never);

    return {
        initialisationHandler: () => initialisationHandler,
        module,
        plugin,
        services,
        settingsLoadedHandler: () => settingsLoadedHandler,
    };
}

describe("ModuleObsidianSettingDialogue startup lifecycle", () => {
    beforeEach(() => {
        settingTabState.callOrder.length = 0;
        settingTabState.reloadAllSettings.mockClear();
        eventHubState.onEvent.mockClear();
        osycSettingsState.openOsycSettings.mockClear();
    });

    it("registers the setting tab after persisted settings have loaded", () => {
        const { initialisationHandler, services, settingsLoadedHandler } = createModuleHarness();

        expect(services.appLifecycle.onInitialise.addHandler).not.toHaveBeenCalled();
        expect(services.appLifecycle.onSettingLoaded.addHandler).toHaveBeenCalledOnce();
        expect(initialisationHandler()).toBeUndefined();
        expect(settingsLoadedHandler()).toBeTypeOf("function");
    });

    it("opens the OsyC settings modal instead of jumping into Obsidian settings", async () => {
        const { plugin, settingsLoadedHandler } = createModuleHarness();

        // 订阅发生在设置载入之后（`_everyOnloadAfterLoadSettings`），先把这一步跑掉。
        const loaded = settingsLoadedHandler();
        expect(loaded).toBeTypeOf("function");
        await loaded!();

        const [event, openSettings] = eventHubState.onEvent.mock.calls[0] ?? [];
        expect(event).toBe("request-open-settings");
        expect(openSettings).toBeTypeOf("function");

        (openSettings as () => void)();

        expect(osycSettingsState.openOsycSettings).toHaveBeenCalledExactlyOnceWith(plugin.app);
    });

    it("seeds the setting editor without requesting a render before registration", async () => {
        const { initialisationHandler, settingsLoadedHandler } = createModuleHarness();
        const handler = settingsLoadedHandler() ?? initialisationHandler();

        expect(handler).toBeTypeOf("function");
        await handler!();

        expect(settingTabState.reloadAllSettings).toHaveBeenCalledWith(true);
        expect(settingTabState.callOrder).toEqual(["reload:true", "add-setting-tab"]);
    });
});
